import { handleApi } from "../../server/handle";

export default async function handler(request: Request): Promise<Response> {
  return handleApi(request, process.env);
}

export const config = {
  path: ["/api/health", "/api/frame"],
};
