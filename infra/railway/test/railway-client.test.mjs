import assert from "node:assert/strict";
import { test } from "node:test";
import { QUERIES, RAILWAY_ENDPOINT, RailwayApiError, createRailwayClient } from "../scripts/lib/railway-client.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** A fetch that answers from a queue and records each call. */
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}
const client = (fetch, extra = {}) => createRailwayClient({ token: "t0ken", fetch, sleep: async () => {}, ...extra });

test("requests go to Railway's GraphQL endpoint with the project token header and never Bearer", async () => {
  const { fetch, calls } = fakeFetch(json({ data: { projectToken: { projectId: "p", environmentId: "e" } } }));
  assert.deepEqual(await client(fetch).scope(), { projectId: "p", environmentId: "e" });
  assert.equal(calls[0].url, RAILWAY_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["project-access-token"], "t0ken");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].body.query, QUERIES.projectToken);
});

test("a missing token is refused before any request", () => {
  assert.throws(() => createRailwayClient({ token: "" }), /RAILWAY_TOKEN is not set/);
});

test("project flattens the edges into services and environments", async () => {
  const connection = (...nodes) => ({ edges: nodes.map((node) => ({ node })) });
  const { fetch } = fakeFetch(
    json({
      data: {
        project: {
          id: "p",
          environments: connection({ id: "e1", name: "staging" }),
          services: connection({ id: "s1", name: "api" }),
        },
      },
    }),
  );
  assert.deepEqual(await client(fetch).project("p"), {
    environments: [{ id: "e1", name: "staging" }],
    services: [{ id: "s1", name: "api" }],
  });
});

test("GraphQL errors in an HTTP 200 answer are raised without the token or variables", async () => {
  const { fetch } = fakeFetch(json({ errors: [{ message: "Not Authorized" }] }));
  await assert.rejects(client(fetch).scope(), (error) => {
    assert.ok(error instanceof RailwayApiError);
    assert.match(error.message, /Not Authorized/);
    assert.doesNotMatch(error.message, /t0ken/);
    return true;
  });
});

test("queries retry transient failures (network error, 503) and then succeed", async () => {
  const { fetch, calls } = fakeFetch(
    new TypeError("fetch failed"),
    json({}, 503),
    json({ data: { deployment: { id: "d", status: "SUCCESS" } } }),
  );
  assert.deepEqual(await client(fetch).deployment("d"), { id: "d", status: "SUCCESS" });
  assert.equal(calls.length, 3);
});

test("queries give up after the retry budget and report the HTTP status", async () => {
  const { fetch, calls } = fakeFetch(json({}, 503), json({}, 503), json({}, 503));
  await assert.rejects(client(fetch).deployment("d"), /HTTP 503/);
  assert.equal(calls.length, 3);
});

test("queries retry Railway's generic 'Problem processing request' error", async () => {
  const { fetch, calls } = fakeFetch(
    json({ errors: [{ message: "Problem processing request" }] }),
    json({ data: { deployment: { id: "d", status: "SUCCESS" } } }),
  );
  assert.deepEqual(await client(fetch).deployment("d"), { id: "d", status: "SUCCESS" });
  assert.equal(calls.length, 2);
});

test("other GraphQL errors are not retried", async () => {
  const { fetch, calls } = fakeFetch(json({ errors: [{ message: "Not Authorized" }] }), json({ data: {} }));
  await assert.rejects(client(fetch).deployment("d"), /Not Authorized/);
  assert.equal(calls.length, 1);
});

test("the settings update retries transient failures, since it sets the whole state", async () => {
  const { fetch, calls } = fakeFetch(
    json({ errors: [{ message: "Problem processing request" }] }),
    json({}, 503),
    json({ data: { serviceInstanceUpdate: true } }),
  );
  await client(fetch).updateServiceInstance("s", "e", { source: { image: "x" } });
  assert.equal(calls.length, 3);
});

test("the settings update gives up after the retry budget with Railway's message", async () => {
  const problem = () => json({ errors: [{ message: "Problem processing request" }] });
  const { fetch, calls } = fakeFetch(problem(), problem(), problem());
  await assert.rejects(client(fetch).updateServiceInstance("s", "e", {}), /Problem processing request/);
  assert.equal(calls.length, 3);
});

test("the deploy trigger is sent exactly once, even when the request fails", async () => {
  const { fetch, calls } = fakeFetch(json({}, 503), json({ data: { serviceInstanceDeployV2: "d1" } }));
  await assert.rejects(client(fetch).deployServiceInstance("s", "e"), /HTTP 503/);
  assert.equal(calls.length, 1);
});

test("the deploy trigger does not retry 'Problem processing request' either", async () => {
  const { fetch, calls } = fakeFetch(
    json({ errors: [{ message: "Problem processing request" }] }),
    json({ data: { serviceInstanceDeployV2: "d1" } }),
  );
  await assert.rejects(client(fetch).deployServiceInstance("s", "e"), /Problem processing request/);
  assert.equal(calls.length, 1);
});

test("updateServiceInstance and deployServiceInstance send the documented variables", async () => {
  const { fetch, calls } = fakeFetch(
    json({ data: { serviceInstanceUpdate: true } }),
    json({ data: { serviceInstanceDeployV2: "dep-1" } }),
  );
  const railway = client(fetch);
  await railway.updateServiceInstance("s", "e", { source: { image: "x" } });
  assert.equal(await railway.deployServiceInstance("s", "e"), "dep-1");
  assert.deepEqual(calls[0].body.variables, { serviceId: "s", environmentId: "e", input: { source: { image: "x" } } });
  assert.deepEqual(calls[1].body.variables, { serviceId: "s", environmentId: "e" });
});
