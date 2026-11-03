/**
 * Strict deletion ordering across the WebView, the native sealed inbox and
 * Android Keystore. Any failed stage aborts the remaining destructive steps;
 * the UI must never claim that deletion succeeded on partial failure.
 */
export interface AccountWipeSteps {
  stopTransport(): Promise<void>;
  deleteDatabases(): Promise<void>;
  clearNativeInbound(): Promise<void>;
  eraseIdentityKeys(): Promise<void>;
}
export async function runAccountWipe(steps: AccountWipeSteps): Promise<void> {
  await steps.stopTransport();
  await steps.deleteDatabases();
  await steps.clearNativeInbound();
  await steps.eraseIdentityKeys();
}
