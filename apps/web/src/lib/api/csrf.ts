/** CSRF token of the signed-in session (GET /v1/me): set by the SessionProvider, sent as X-CSRF-Token on writes. */
let token: string | undefined;

export const setCsrfToken = (value: string | undefined): void => {
  token = value;
};
export const getCsrfToken = (): string | undefined => token;
