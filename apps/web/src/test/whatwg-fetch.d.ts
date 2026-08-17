declare module "whatwg-fetch" {
  export const Headers: {
    new (init?: HeadersInit): Headers;
  };
  export const Request: {
    new (input: RequestInfo | URL, init?: RequestInit): Request;
  };
  export const Response: {
    new (body?: BodyInit | null, init?: ResponseInit): Response;
  };
}
