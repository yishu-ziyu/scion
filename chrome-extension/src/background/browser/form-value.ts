export interface FormControlDescriptor {
  tagName?: string | null;
  type?: string;
  role?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  label?: string;
  placeholder?: string;
}

export interface ObservableFormValue {
  value?: string;
  valueRedacted?: true;
}

function normalized(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Classify from field metadata only. Never inspect the value to decide whether it is safe. */
export function isSensitiveFormControl(control: FormControlDescriptor): boolean {
  const type = normalized(control.type);
  if (type === 'password') return true;

  const autocomplete = normalized(control.autocomplete);
  if (
    autocomplete === 'current password' ||
    autocomplete === 'new password' ||
    autocomplete === 'one time code' ||
    autocomplete === 'webauthn' ||
    (autocomplete === 'off' && type === 'password') ||
    autocomplete.startsWith('cc ')
  ) {
    return true;
  }

  const identity = normalized(
    [control.type, control.role, control.name, control.id, control.label, control.placeholder]
      .filter(Boolean)
      .join(' '),
  );
  if (!identity) return false;

  const password = /(?:^|\W)(?:password|passwd|passcode|pwd)(?:$|\W)|密码|口令/i;
  const oneTimeCode =
    /(?:^|\W)(?:otp|totp|2fa|mfa)(?:$|\W)|one\s*time\s*(?:code|password)|verification\s*code|auth(?:entication)?\s*code|security\s*code|验证码|校验码|动态码/i;
  const paymentCard =
    /(?:credit|debit|bank|payment)\s*card|card\s*(?:number|no\b|#|cvv|cvc|csc|expiry|expiration)|(?:^|\W)cc\s*(?:number|num|no|cvv|cvc|csc|exp)|(?:^|\W)(?:cvv|cvc|csc)(?:$|\W)|银行卡|卡号/i;
  const bankAccount = /(?:^|\W)iban(?:$|\W)|bank\s*account|routing\s*number/i;
  const secret =
    /(?:^|\W)(?:api\s*key|access\s*token|client\s*secret|auth(?:orization)?|bearer|secret|token|pin)(?:$|\W)|私钥|密钥/i;
  return (
    password.test(identity) ||
    oneTimeCode.test(identity) ||
    paymentCard.test(identity) ||
    bankAccount.test(identity) ||
    secret.test(identity)
  );
}

export function observableFormValue(control: FormControlDescriptor, value: string | undefined): ObservableFormValue {
  return isSensitiveFormControl(control) ? { valueRedacted: true } : { value };
}
