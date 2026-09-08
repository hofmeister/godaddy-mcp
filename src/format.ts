export interface Money {
  currencyCode?: string;
  value: number;
}

/** GoDaddy prices are integer amounts in minor units (cents). */
export function formatMoney(money?: Money | null): string | undefined {
  if (!money || typeof money.value !== "number") {
    return undefined;
  }
  return `${(money.value / 100).toFixed(2)} ${money.currencyCode ?? "USD"}`;
}

export interface TermPriceInput {
  term?: string;
  period?: number;
  price?: Money | null;
  renewalPrice?: Money | null;
  firstTermPrice?: Money | null;
  recommended?: boolean;
  fees?: Array<{ type: string; fee: Money }>;
}

export interface FormattedTermPrice {
  period: number;
  price: string;
  renewal?: string;
  firstTermPrice?: string;
  recommended?: boolean;
  fees?: Array<{ type: string; amount: string }>;
}

export function formatTermPrices(
  prices?: TermPriceInput[] | null,
): FormattedTermPrice[] | undefined {
  if (!Array.isArray(prices) || prices.length === 0) {
    return undefined;
  }
  return prices.map((p) => {
    const out: FormattedTermPrice = {
      period: p.period ?? 1,
      price: formatMoney(p.price) ?? "unknown",
    };
    const renewal = formatMoney(p.renewalPrice);
    if (renewal) {
      out.renewal = renewal;
    }
    const firstTerm = formatMoney(p.firstTermPrice);
    if (firstTerm) {
      out.firstTermPrice = firstTerm;
    }
    if (p.recommended === true) {
      out.recommended = true;
    }
    if (Array.isArray(p.fees) && p.fees.length > 0) {
      out.fees = p.fees.map((f) => ({
        type: f.type,
        amount: formatMoney(f.fee) ?? "unknown",
      }));
    }
    return out;
  });
}
