export interface Tavern {
  id: number;
  name: string;
  ville: string;
  description: string;
  image?: string;
}

export type MessageType = "normal" | "emote" | "whisper" | "system" | "error" | "drink" | "meal" | "tournee";

// Lane F1 — social/economy chat lines:
//  drink   = taverneOffreVerre / taverneOffreTisane / self drink (nomMenu == "alcool")
//  meal    = taverneMangeMenu (menu item ordered)
//  tournee = taverneTourneeGenerale (general round)

export interface ChatMessage {
  id: string;
  type: MessageType;
  login?: string;
  content: string;
  timestamp: string; // locale time
  created_at: string; // ISO
  whisperTarget?: string;
}

// Lane F1 — tavern menus (taverneMajMenus payload):
//   infos = { menuBoisson?: { prix: number }, menu0?: {...}, menu1?: {...} }
//   menu item = { nom: string, prix: number (centimes), ingredients: number[] (item ids) }
export interface TavernMenuItem {
  id: number; // 0 | 1 — reused for taverneCommandeRepas via `/manger <id>`
  nom: string;
  prix: number; // centimes (prix / 100 = écus)
  ingredients: string[];
}

export interface TavernMenus {
  plats: TavernMenuItem[];
  boissonPrix: number | null; // centimes, null when the drink menu is hidden
}

// Lane F1 — tournée générale overlay (taverneTourneeGenerale event).
export interface TourneeInfo {
  login: string; // display (ucfirst)
  key: string; // unique per event, retriggers the CSS animation
}

// Lane F1 — écus balance pulse (spend/up animation in ChatHeader).
export interface EcusPulse {
  dir: "down" | "up";
  key: number;
}

// Tavern occupancy
export type PlaceId = number; // 0..9
export type Places = (string | null)[]; // index = place id

// Props — keep minimal, match actual usage in App.tsx

// Step 1 — pure credential fields (no tavern picker, no remembered block).
export interface LoginFieldsProps {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  loading: boolean;
}

// Step 1 — saved accounts: preselect (radio) then Connect, remove per row.
export interface AccountPickerProps {
  accounts: string[];
  pickedAccount: string | null;
  onPick: (username: string) => void;
  onRemove: (username: string) => void;
  onUseAnother: () => void;
  loading: boolean;
}

// Step 1 — orchestrates AccountPicker + LoginForm.
export interface AuthStepProps {
  accounts: string[];
  pickedAccount: string | null;
  setPickedAccount: (v: string | null) => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  useAnother: boolean;
  setUseAnother: (v: boolean) => void;
  loading: boolean;
  error: string;
  status: string;
  onConnectSaved: () => void;
  onConnectForm: (e: Event) => void;
  onRemoveAccount: (username: string) => void;
}

// Step 2 — tavern choice with recents above the carousel.
export interface TavernSelectProps {
  taverns: Tavern[];
  selectedId: number;
  onSelect: (id: number) => void;
  recents: number[];
  username: string;
  loading: boolean;
  error: string;
  status: string;
  onEnter: () => void;
  onBack: () => void;
  onForgetCurrent?: () => void;
}

export interface RecentTavernsProps {
  tavernIds: number[];
  taverns: Tavern[];
  selectedId: number;
  onPick: (id: number) => void;
}

export interface ChatRoomProps {
  messages: ChatMessage[];
  presentUsers: string[];
  places?: Places;
  selectedPlace?: number | null;
  onChangePlace?: (id: PlaceId) => void;
  totalPlaces?: number;
  inputMessage: string;
  setInputMessage: (v: string) => void;
  onSend: (e: Event) => void;
  onDisconnect: () => void;
  onCopy?: () => Promise<void>;
  isConnected: boolean;
  tavernName: string;
  currentUser?: string;
  typingUsers?: string[];
  // Lane F2 — tavern ground type (ws NombrePlaces frame `Lieu`, e.g.
  // "eglise"): drives the reserved-seat status icons. Null = unknown yet.
  lieu?: string | null;
  // Lane F1 — social/economy (all optional so older callers keep compiling).
  menus?: TavernMenus;
  ecus?: number | null; // écus (argent centimes / 100), null = unknown yet
  ecusPulse?: EcusPulse | null;
  tournee?: TourneeInfo | null;
  clearTournee?: () => void;
  onOfferDrink?: (login: string) => void;
  onOrderMenu?: (id: number) => void;
  onOrderDrink?: () => void;
  onBuyTournee?: () => void;
  // Lane F3 — drunkenness + alcohol consent (ChatHeader gauge + toggle).
  alcoolRate?: number | null; // ~0..20 official scale, null = unknown yet
  accepteAlcool?: boolean | null; // null = unknown yet (toggle hidden)
  onToggleAlcool?: () => void;
  // Tisane rules: per-player alcohol consent (keys = lowercased login).
  // Absent key = unknown → assume accepts. Drives the tisane labels in
  // PlayerMenu (target) / MenuPopup (self).
  alcoolByLogin?: Record<string, boolean>;
  // Lane F3 — fatal moderation flags + refresh request (blocking overlay).
  kicked?: boolean;
  banned?: boolean;
  needsRefresh?: boolean;
  // Lane F3 — flood mute (taverneBanFlood): input disabled while true.
  floodMuted?: boolean;
  // Lane F3 — moderation (PlayerMenu; server enforces rights).
  onKickPlayer?: (login: string) => void;
  onBanPlayer?: (login: string) => void;
  onUnbanPlayer?: (login: string) => void;
}
