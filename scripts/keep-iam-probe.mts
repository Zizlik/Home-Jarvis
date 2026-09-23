// Read-only: who holds which role on the Keep service account (IAM policy).
import { accessToken } from "../src/lib/google/auth";

const email = process.env.GOOGLE_KEEP_SERVICE_ACCOUNT!;
const res = await fetch(`https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:getIamPolicy`, {
  method: "POST",
  headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
  body: "{}",
});
const data = (await res.json()) as { bindings?: { role: string; members: string[] }[]; error?: { message?: string } };
console.log(res.status, data.error?.message ?? JSON.stringify(data.bindings ?? "(žádné role na účtu)", null, 1));
