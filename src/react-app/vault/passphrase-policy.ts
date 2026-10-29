import { validatePassphrase } from './crypto';

// Creation policy is separate so existing vault passphrases remain usable.
export function validateNewPassphrase(secret:string):void {
  validatePassphrase(secret);
  if ([...secret].length<15 || !secret.trim() || /\p{Cc}/u.test(secret) || /^(.{1,4})\1+$/u.test(secret) || /^(?:passwordpassword|password123456789|qwertyuiopasdfgh|1234567890abcdef|letmeinletmeinletmein)$/iu.test(secret)) {
    throw new Error('Use a unique passphrase of 15–256 characters; avoid common or repeated values');
  }
}
