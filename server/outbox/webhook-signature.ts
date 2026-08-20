import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const generateWebhookSecret = () =>
  `whsec_${randomBytes(24).toString("base64url")}`;

export const signWebhookPayload = (
  secret: string,
  timestamp: number | string,
  payload: unknown,
) =>
  `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest("hex")}`;

export const verifyWebhookSignature = (input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  payload: unknown;
  maxSkewMs?: number;
}) => {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > (input.maxSkewMs ?? 5 * 60_000))
    return false;
  if (!input.signature) return false;
  const expected = signWebhookPayload(
    input.secret,
    input.timestamp!,
    input.payload,
  );
  const received = Buffer.from(input.signature);
  const calculated = Buffer.from(expected);
  return (
    received.length === calculated.length &&
    timingSafeEqual(received, calculated)
  );
};
