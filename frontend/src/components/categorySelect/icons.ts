import {
  Home, Zap, UtensilsCrossed, Car, Shield, HeartPulse,
  Coffee, Gamepad2, HelpCircle, Hammer, Shirt, Banknote,
  TrendingUp, PiggyBank, ArrowDownToLine,
  Wallet, RotateCcw, CircleDollarSign, ArrowLeftRight,
  Coins, BadgeEuro,
  type LucideIcon,
} from 'lucide-react'

/* ── Icon mapping by category name ── */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'Taxes & Mortgage':           Home,
  'Utilities':                  Zap,
  'Food - Essential':           UtensilsCrossed,
  'Transportation':             Car,
  'Insurance':                  Shield,
  'Medical & Healthcare':       HeartPulse,
  'Food - Not Essential':       Coffee,
  'Recreation & Entertainment': Gamepad2,
  'Miscellaneous':              HelpCircle,
  'Home & DIY':                 Hammer,
  'Clothing':                   Shirt,
  'Cash Withdrawal':            Banknote,
  'DEGIRO':                     TrendingUp,
  'Fun Account':                PiggyBank,
  'Savings Transfer':           ArrowDownToLine,
  'Salary':                     Wallet,
  'Retained Salary':            BadgeEuro,
  'Personal Allowance':         Coins,
  'Refunds':                    RotateCcw,
  'Other Income':               CircleDollarSign,
  'Internal Transfer':          ArrowLeftRight,
}

export const TYPE_FALLBACK_ICONS: Record<string, LucideIcon> = {
  needs: Home, wants: Gamepad2, savings: PiggyBank, income: Wallet, exclude: ArrowLeftRight,
}

export function getCategoryIcon(name: string, type: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? TYPE_FALLBACK_ICONS[type] ?? HelpCircle
}
