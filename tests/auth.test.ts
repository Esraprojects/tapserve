import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthError,
  createSession,
  deleteSession,
  getSession,
  loginWithEmail,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_WINDOW,
  requestPhoneOtp,
  signUpWithEmail,
  type SmsProvider,
  type Sql,
  verifyPhoneOtp,
} from "@tapserve/db";
import { freshDatabase } from "./db";

let admin: Sql;
let app: Sql;
const sent: { to: string; message: string }[] = [];
const sms: SmsProvider = { send: async (to, message) => void sent.push({ to, message }) };
const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.message)![1]!;

beforeAll(async () => {
  ({ admin, app } = await freshDatabase());
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);

describe("email sign-up and login", () => {
  it("signs up, stores a hash (not the password) and logs in", async () => {
    await signUpWithEmail(app, { email: "Owner@Example.com", password: "s3cret-pass", fullName: "Owner" });
    const [row] = await admin`select password_hash from users where email = 'owner@example.com'`;
    expect(row?.password_hash).toMatch(/^scrypt\$/);
    expect((await loginWithEmail(app, "owner@example.com", "s3cret-pass")).full_name).toBe("Owner");
  });

  it("rejects wrong passwords, duplicates and weak passwords", async () => {
    expect(await code(loginWithEmail(app, "owner@example.com", "wrong-pass"))).toBe("invalid_credentials");
    expect(await code(signUpWithEmail(app, { email: "owner@example.com", password: "another-pass", fullName: "" }))).toBe("email_taken");
    expect(await code(signUpWithEmail(app, { email: "new@example.com", password: "short", fullName: "" }))).toBe("weak_password");
  });
});

describe("phone OTP", () => {
  it("logs in with a valid code and creates the user", async () => {
    await requestPhoneOtp(app, sms, "0911223344");
    expect(sent.at(-1)?.to).toBe("+251911223344");
    const user = await verifyPhoneOtp(app, "+251911223344", lastCode());
    expect(user.phone).toBe("+251911223344");
    // A code works only once.
    expect(await code(verifyPhoneOtp(app, "0911223344", lastCode()))).toBe("invalid_code");
  });

  it("rejects non-Ethiopian numbers", async () => {
    expect(await code(requestPhoneOtp(app, sms, "+254711223344"))).toBe("invalid_phone");
  });

  it("rate-limits code requests per phone", async () => {
    for (let i = 0; i < OTP_MAX_PER_WINDOW; i++) await requestPhoneOtp(app, sms, "0922334455");
    expect(await code(requestPhoneOtp(app, sms, "0922334455"))).toBe("rate_limited");
  });

  it("locks a code after too many wrong attempts", async () => {
    await requestPhoneOtp(app, sms, "0733445566");
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await code(verifyPhoneOtp(app, "0733445566", wrong))).toBe("invalid_code");
    }
    expect(await code(verifyPhoneOtp(app, "0733445566", right))).toBe("too_many_attempts");
  });

  it("rejects expired codes", async () => {
    await requestPhoneOtp(app, sms, "0944556677");
    await admin`update otp_codes set expires_at = now() - interval '1 minute' where phone = '+251944556677'`;
    expect(await code(verifyPhoneOtp(app, "0944556677", lastCode()))).toBe("code_expired");
  });
});

describe("sessions", () => {
  it("creates, reads and deletes a session; only the token hash is stored", async () => {
    const user = await signUpWithEmail(app, { email: "session@example.com", password: "password-1", fullName: "S" });
    const token = await createSession(app, user.id);
    expect((await getSession(app, token))?.user.id).toBe(user.id);
    expect(await admin`select 1 from sessions where token_hash = ${token}`).toHaveLength(0);
    await deleteSession(app, token);
    expect(await getSession(app, token)).toBeNull();
  });
});
