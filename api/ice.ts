import { handleIceRequest } from '../server/ice/handleIceRequest';

export async function GET(request: Request): Promise<Response> {
  return handleIceRequest(request);
}
