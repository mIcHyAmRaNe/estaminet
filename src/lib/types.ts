export interface Tavern {
  id: number;
  name: string;
  ville: string;
  description: string;
  image?: string;
}

export type MessageType = "normal" | "emote" | "whisper" | "system" | "error";

export interface ChatMessage {
  id: string;
  type: MessageType;
  login?: string;
  content: string;
  timestamp: string; // locale time
  created_at: string; // ISO
  whisperTarget?: string;
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
}
