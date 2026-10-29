import { consoleSmsProvider, type SmsProvider } from "@tapserve/db";

/** SMS gateways plug in here. Only the development console provider exists for now. */
export function smsProvider(): SmsProvider {
  const name = process.env.SMS_PROVIDER ?? "console";
  if (name === "console") return consoleSmsProvider;
  throw new Error(`Unknown SMS_PROVIDER: ${name}`);
}
