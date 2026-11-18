import type { ExpenseCategory } from '../lib/categories';
import { Bus, CircleEllipsis, PartyPopper, Receipt, ShoppingBag, Utensils, type LucideIcon } from '../icons';

/**
 * A category is told apart by its icon and its name, never by colour alone:
 * six hues side by side cannot all be distinguished with colour-blindness.
 */
export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  food: Utensils,
  transport: Bus,
  shopping: ShoppingBag,
  bills: Receipt,
  fun: PartyPopper,
  other: CircleEllipsis,
};
