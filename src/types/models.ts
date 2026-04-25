import type { Timestamp } from "firebase/firestore";

export type BillingPlanType = "trial" | "monthly" | "daily" | "slot";

export type Seller = {
  id: string;
  shopName?: string;
  ownerName?: string;
  phone?: string;
  shopCode?: string;
  whatsappNumber?: string;
  /** @deprecated Legacy field — do not set on new sellers */
  password?: string;
  /** When false, storefront selling is disabled (e.g. unpaid). */
  sellingEnabled?: boolean;
  pendingDues?: number;
  billingPlanType?: BillingPlanType;
  locationCity?: string;
  locationState?: string;
  locationCountry?: string;
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

export type SellerProduct = {
  id: string;
  sellerId?: string;
  name?: string;
  /** Optional link to globalMenuCategories doc for admin “in use” checks */
  globalMenuCategoryId?: string;
  /** Menu section label (Breakfast, Lunch, …) — align with menus collection names */
  menuGroup?: string;
  category?: string;
  /** When true or itemType === "combo", counted as combo in admin */
  isCombo?: boolean;
  itemType?: string;
  type?: string;
  price?: number;
  qty?: number;
  quantity?: number;
  stock?: number;
  available?: boolean;
  featured?: boolean;
  imageUrl?: string;
  photoUrl?: string;
  image?: string;
  createdAt?: Timestamp | string;
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
  /**
   * Buyer app public shop URL; use literal `{shopCode}` once (e.g. https://fafo.app/s/{shopCode}).
   * Seller admin substitutes the seller shop code when present.
   */
  buyerShopPublicUrlTemplate?: string;
};

/** Firestore: globalCuisineCategories — platform-wide cuisines for seller filtering */
export type GlobalCuisineCategory = {
  id: string;
  name?: string;
  slug?: string;
  active?: boolean;
  sortOrder?: number;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  /** When set, row is archived (soft delete). */
  deletedAt?: Timestamp | string | null;
};

/** Firestore: globalMenuCategories — catalog labels linkable to multiple cuisines */
export type GlobalMenuCategory = {
  id: string;
  name?: string;
  slug?: string;
  /** Global cuisine document ids where this menu category appears */
  cuisineIds?: string[];
  active?: boolean;
  sortOrder?: number;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  deletedAt?: Timestamp | string | null;
};

/** Where the creative runs (seller + buyer surfaces) */
export type AdPlacement = "seller_home" | "seller_dashboard" | "buyer_explore" | "buyer_shop";

/** Who sees the ad */
export type AdAudience = "global" | "seller_specific" | "buyer_specific";

/** Seller app ads — managed from Admin → Ads Management */
export type FafoAd = {
  id: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  active?: boolean;
  startAt?: Timestamp | string;
  endAt?: Timestamp | string;
  /** v2: single surface per row */
  placement?: AdPlacement;
  audience?: AdAudience;
  targetSellerIds?: string[];
  /** Reserved for buyer-specific explore ads */
  targetBuyerIds?: string[];
  bannerImageUrl?: string;
  /** Higher runs first in admin + client lists */
  priority?: number;
  /** Multiple surfaces in one campaign */
  placements?: AdPlacement[];
  /** Full creative set; first item mirrors bannerImageUrl for older clients */
  bannerUrls?: string[];
  /** Legacy (pre-v2) — still read for thumbnails until migrated */
  targetMode?: "all" | "selected";
  placementHome?: boolean;
  placementDashboard?: boolean;
  /** Buyer app: explore / discovery feed */
  placementBuyerExplore?: boolean;
  /** Buyer app: individual shop / storefront */
  placementBuyerShop?: boolean;
  bannerUrlHome?: string;
  bannerUrlDashboard?: string;
  bannerUrlBuyerExplore?: string;
  bannerUrlBuyerShop?: string;
  /** Seller app: seller doc id or `"all"` */
  targetSellerId?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
};

export type AdClickKind = "impression" | "click";

/** Must match placement on the ad document for seller/buyer apps */
export type AdClickPlacement = "seller_home" | "seller_dashboard" | "buyer_explore" | "buyer_shop";

export type AdClickEvent = {
  id: string;
  adId?: string;
  sellerId?: string;
  buyerId?: string;
  placement?: AdClickPlacement;
  kind?: AdClickKind;
  createdAt?: Timestamp | string;
};

/** Menu group for a seller (Breakfast, Lunch, …) */
export type SellerMenu = {
  id: string;
  sellerId?: string;
  name?: string;
  sortOrder?: number;
  productIds?: string[];
  createdAt?: Timestamp | string;
};

/** Wallet / slot adjustments written by admin flows (billingLogs) */
export type BillingLogEntry = {
  id: string;
  sellerId?: string;
  /** e.g. GO_LIVE, ADD_SLOTS, ADMIN_WALLET_TOPUP */
  action?: string;
  slotsAdded?: number;
  /** Positive = credit to wallet; negative = deduction when used by apps */
  amountAdded?: number;
  adminId?: string;
  notes?: string;
  startImmediately?: boolean;
  autoActivateLive?: boolean;
  createdAt?: Timestamp | string;
};
