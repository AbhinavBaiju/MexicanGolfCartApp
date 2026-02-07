import type { LoaderFunctionArgs } from "@remix-run/node";

import { redirectToAdminSpaPath } from "../utils/adminSpaRedirect.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return redirectToAdminSpaPath(request, "/bookings");
};

export default function AppIndexRedirect() {
  return null;
}
