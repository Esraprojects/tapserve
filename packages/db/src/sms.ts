/** Pluggable SMS gateway. Local Ethiopian gateways implement this; SMS is off unless configured. */
export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

/** Development provider: prints messages to the server log instead of sending them. */
export const consoleSmsProvider: SmsProvider = {
  async send(to, message) {
    console.info(`[sms] to ${to}: ${message}`);
  },
};
