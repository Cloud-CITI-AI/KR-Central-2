/** Full-page navigation behind one seam so components and the API client can be tested (jsdom cannot navigate). */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
