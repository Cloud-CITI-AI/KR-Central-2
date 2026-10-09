/**
 * Railway public GraphQL API client (https://backboard.railway.com/graphql/v2). Every query and mutation lives here so
 * that docs/deploy/railway.md has one place to check; each is marked UNVERIFIED there until proven against a real
 * staging project (the Railway docs could not be reached when this was written). Authentication is a project token in the
 * `Project-Access-Token` header (Railway's documented header for project tokens; account/workspace tokens use
 * `Authorization: Bearer` instead). The token is never logged and never part of an error message.
 */
export const RAILWAY_ENDPOINT = "https://backboard.railway.com/graphql/v2";

const INSTANCE_FIELDS = `source { image } startCommand healthcheckPath healthcheckTimeout restartPolicyType
  restartPolicyMaxRetries cronSchedule numReplicas sleepApplication latestDeployment { id status }`;

export const QUERIES = Object.freeze({
  projectToken: "query { projectToken { projectId environmentId } }",
  project: `query ($id: String!) { project(id: $id) { id
    environments { edges { node { id name } } } services { edges { node { id name } } } } }`,
  serviceInstance: `query ($environmentId: String!, $serviceId: String!) {
    serviceInstance(environmentId: $environmentId, serviceId: $serviceId) { ${INSTANCE_FIELDS} } }`,
  deployment: "query ($id: String!) { deployment(id: $id) { id status } }",
  update: `mutation ($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`,
  deploy: `mutation ($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }`,
});

export class RailwayApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "RailwayApiError";
  }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const edges = (connection) => connection.edges.map((edge) => edge.node);

export function createRailwayClient({
  token,
  fetch: fetchImpl = globalThis.fetch,
  endpoint = RAILWAY_ENDPOINT,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  queryRetries = 2,
}) {
  if (!token) throw new RailwayApiError("RAILWAY_TOKEN is not set");

  /** Mutations are sent once (a repeated deploy trigger would deploy twice); queries retry transient failures. */
  async function request(query, variables, retries) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "project-access-token": token },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt < retries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new RailwayApiError(`Railway API unreachable: ${error.message}`);
      }
      if (RETRY_STATUSES.has(response.status) && attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      // Railway answers many authorisation and validation failures with HTTP 200 and an `errors` array.
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new RailwayApiError(`Railway API answered HTTP ${response.status}`);
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        throw new RailwayApiError(`Railway API error: ${body.errors.map((e) => e.message).join("; ")}`);
      }
      if (body.data === undefined || body.data === null) throw new RailwayApiError("Railway API returned no data");
      return body.data;
    }
  }

  const query = (text, variables = {}) => request(text, variables, queryRetries);
  return {
    /** The project and environment a project token is scoped to. */
    async scope() {
      return (await query(QUERIES.projectToken)).projectToken;
    },
    /** Services and environments of the project as {id, name} lists. */
    async project(id) {
      const { project } = await query(QUERIES.project, { id });
      return { environments: edges(project.environments), services: edges(project.services) };
    },
    async serviceInstance(environmentId, serviceId) {
      return (await query(QUERIES.serviceInstance, { environmentId, serviceId })).serviceInstance;
    },
    async deployment(id) {
      return (await query(QUERIES.deployment, { id })).deployment;
    },
    async updateServiceInstance(serviceId, environmentId, input) {
      await request(QUERIES.update, { serviceId, environmentId, input }, 0);
    },
    /** Triggers a deployment of the service's current configuration; returns the new deployment id. */
    async deployServiceInstance(serviceId, environmentId) {
      return (await request(QUERIES.deploy, { serviceId, environmentId }, 0)).serviceInstanceDeployV2;
    },
  };
}
