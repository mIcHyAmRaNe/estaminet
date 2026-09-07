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
export interface LoginFormProps {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  taverns: Tavern[];
  idLieu: number;
  setIdLieu: (v: number) => void;
  error: string;
  status: string;
  loading: boolean;
  onSubmit: (e: Event) => void;
  onDisconnect?: () => void;
  rememberedLogin: string | null;
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
