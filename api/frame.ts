import { handleApi } from "../server/handle";
import { send, toRequest } from "./health";

export default async function handler(request: any, response: any): Promise<void> {
  await send(request, response, await handleApi(await toRequest(request), process.env));
}
