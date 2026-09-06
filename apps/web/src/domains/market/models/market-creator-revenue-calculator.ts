/**
 * market-creator-revenue-calculator.ts
 *
 * Creator Royalty & Marketplace Settlement Calculator.
 * Benchmarks Acon3D, Pixiv BOOTH, Postype, and Gumroad settlement algorithms.
 *
 * - Calculates exact net creator payout after platform fees, payment gateway (PG) fees,
 *   and withholding tax deductions.
 * - Supports Creator Boost (optional fan tip) with 100% creator pass-through (minus PG fee).
 * - Transparent breakdown for marketplace creators to forecast earnings.
 */

export type CreatorTier = "standard-creator" | "pro-partner";

export interface SettlementInput {
  readonly priceKrw: number;
  readonly creatorTier: CreatorTier;
  readonly boostTipKrw?: number;
}

export interface SettlementBreakdown {
  readonly grossPriceKrw: number;
  readonly boostTipKrw: number;
  readonly platformFeeRatePercent: number;
  readonly platformFeeKrw: number;
  readonly pgFeeKrw: number; // 3.3% PG processing fee
  readonly withholdingTaxKrw: number; // 3.3% statutory income tax withheld
  readonly netCreatorPayoutKrw: number;
  readonly creatorEffectiveTakeRatePercent: number; // e.g. 78.4%
}

export class MarketCreatorRevenueCalculator {
  private readonly PG_FEE_RATE = 0.033; // 3.3%
  private readonly WITHHOLDING_TAX_RATE = 0.033; // 3.3%

  /**
   * Computes exact settlement deductions and net payout for an asset sale.
   */
  public calculate(input: SettlementInput): SettlementBreakdown {
    const grossPrice = Math.max(0, Math.round(input.priceKrw));
    const boostTip = Math.max(0, Math.round(input.boostTipKrw ?? 0));

    // Platform fee rate: 20% standard, 10% pro partner
    const platformRate = input.creatorTier === "pro-partner" ? 0.10 : 0.20;
    const platformFee = Math.round(grossPrice * platformRate);

    // PG fee applies to total charged amount (gross + tip)
    const totalCharged = grossPrice + boostTip;
    const pgFee = Math.round(totalCharged * this.PG_FEE_RATE);

    // Taxable creator earnings before tax
    const preTaxCreatorEarnings = (grossPrice - platformFee) + boostTip - pgFee;
    const taxableAmount = Math.max(0, preTaxCreatorEarnings);
    const withholdingTax = Math.round(taxableAmount * this.WITHHOLDING_TAX_RATE);

    const netPayout = Math.max(0, taxableAmount - withholdingTax);
    const takeRate = totalCharged > 0 ? (netPayout / totalCharged) * 100 : 0;

    return {
      grossPriceKrw: grossPrice,
      boostTipKrw: boostTip,
      platformFeeRatePercent: Math.round(platformRate * 100),
      platformFeeKrw: platformFee,
      pgFeeKrw: pgFee,
      withholdingTaxKrw: withholdingTax,
      netCreatorPayoutKrw: netPayout,
      creatorEffectiveTakeRatePercent: Number(takeRate.toFixed(1)),
    };
  }

  /**
   * Currency formatter for KRW.
   */
  public formatKrw(amount: number): string {
    return `${amount.toLocaleString("ko-KR")}원`;
  }
}
