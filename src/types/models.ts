import type { Timestamp } from "firebase/firestore";

export type Seller = {
  id: string;
  shopName?: string;
  ownerName?: string;
  phone?: string;
  shopCode?: string;
  /** Plain password for shopCode + password login (matches existing admin pattern) */
  password?: string;
  /** Wallet credited when billing payments are approved */
  walletBalance?: number;
  /** Preferred balance field for seller apps + admin Go Live */
  currentAvailableBalance?: number;
  sellerMode?: string;
  sellerBillingState?: string;
  hasLiveHistory?: boolean;
  activatedAt?: Timestamp | string;
  trialHidden?: boolean;
  trialExpired?: boolean;
  trialSuppressed?: boolean;
  slots?: number;
  isLive?: boolean;
  isBlocked?: boolean;
  location?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  openTime?: string;
  closeTime?: string;
  deliveryEnabled?: boolean;
  upiId?: string;
  qrImageUrl?: string;
  shopImageUrl?: string;
  trialStart?: Timestamp | string;
  trialEnd?: Timestamp | string;
  lastActiveAt?: Timestamp | string;
  createdAt?: Timestamp | string;
  /** Per-seller pricing overrides when enabled */
  pricingOverrideEnabled?: boolean;
  overrideTrialDays?: number;
  overrideSlotRatePerDay?: number;
  overrideOrderFeePercent?: number;
  /** Quick recharge buttons (same shape as global preset amounts) */
  overridePresetAmounts?: number[];
};

export type BuyerUser = {
  id: string;
  name?: string;
  phone?: string;
  location?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  role?: string;
  isBlocked?: boolean;
  favoriteShopId?: string;
  favoriteShopName?: string;
  createdAt?: Timestamp | string;
};

export type OrderItem = {
  name?: string;
  title?: string;
  qty?: number;
  quantity?: number;
  price?: number;
};

export type Order = {
  id: string;
  sellerId?: string;
  buyerId?: string;
  buyerPhone?: string;
  buyerName?: string;
  items?: OrderItem[];
  total?: number;
  status?: string;
  paymentMode?: string;
  refundNote?: string;
  createdAt?: Timestamp | string;
};

export type BillingRecord = {
  id: string;
  sellerId?: string;
  amount?: number;
  status?: string;
  createdAt?: Timestamp | string;
  /** Slots granted when payment is approved */
  packageValue?: number;
  packageName?: string;
  screenshotUrl?: string;
  adminNote?: string;
  source?: string;
  processedAt?: Timestamp | string;
};

export type MessageTemplate = {
  id: string;
  title?: string;
  body?: string;
  updatedAt?: Timestamp | string;
};

export type DiscountTemplate = {
  id: string;
  title?: string;
  code?: string;
  percentOff?: number;
  updatedAt?: Timestamp | string;
};

export type GlobalSettings = {
  platformFee?: number;
  commissionPercent?: number;
  /** Alias used by apps; synced with trialDaysDefault when saving from admin */
  trialDays?: number;
  trialDaysDefault?: number;
  /** INR / day for slot costing in seller apps */
  slotRatePerDay?: number;
  /** Fee on orders (percent) */
  orderFeePercent?: number;
  /** Slot purchase extends “live” days */
  defaultRechargeDays?: number;
  presetAmounts?: number[];
  globalUpiId?: string;
  globalQrImageUrl?: string;
  billingTermsText?: string;
  slotPackages?: { label?: string; slots?: number; price?: number }[];
  deliveryDefaultRadiusKm?: number;
  whatsappSupport?: string;
  appBanners?: { title?: string; body?: string; enabled?: boolean }[];
  maintenanceMode?: boolean;
  forceCloseOrdering?: boolean;
};
