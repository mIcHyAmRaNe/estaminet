// Fluent icons (Regular 24) — source: fluent-icons-viewer, copied into
// src/assets/icons/fluent/ under their original names (ic_fluent_*_24_regular.svg).
// Imported as `?raw` (typed by vite/client, no dependency) then normalized:
// - `#212121` (Fluent mono-color slot) → `currentColor` (dark/light theme)
// - `width/height` injected from the `size` prop (source SVGs have neither,
//   viewBox 24x24) + decorative `aria-hidden`.
// API unchanged (same names/props) for TavernCarousel, LoginForm, etc.
import eyeSvg from "../../assets/icons/fluent/ic_fluent_eye_24_regular.svg?raw";
import eyeOffSvg from "../../assets/icons/fluent/ic_fluent_eye_off_24_regular.svg?raw";
import chevronLeftSvg from "../../assets/icons/fluent/ic_fluent_chevron_left_24_regular.svg?raw";
import chevronRightSvg from "../../assets/icons/fluent/ic_fluent_chevron_right_24_regular.svg?raw";
import dismissSvg from "../../assets/icons/fluent/ic_fluent_dismiss_24_regular.svg?raw";
import sendSvg from "../../assets/icons/fluent/ic_fluent_send_24_regular.svg?raw";
import personCircleOffSvg from "../../assets/icons/fluent/ic_fluent_person_circle_off_24_regular.svg?raw";
import arrowRightSvg from "../../assets/icons/fluent/ic_fluent_arrow_right_24_regular.svg?raw";
import arrowExitSvg from "../../assets/icons/fluent/ic_fluent_arrow_exit_24_regular.svg?raw";
import alertSvg from "../../assets/icons/fluent/ic_fluent_alert_24_regular.svg?raw";
import serviceBellSvg from "../../assets/icons/fluent/ic_fluent_service_bell_24_regular.svg?raw";
// No Fluent "whisper" equivalent: closest chat bubble.
import whisperSvg from "../../assets/icons/fluent/ic_fluent_chat_24_regular.svg?raw";
import copySvg from "../../assets/icons/fluent/ic_fluent_copy_24_regular.svg?raw";
import checkSvg from "../../assets/icons/fluent/ic_fluent_checkmark_24_regular.svg?raw";
import filterSvg from "../../assets/icons/fluent/ic_fluent_filter_24_regular.svg?raw";
import moonSvg from "../../assets/icons/fluent/ic_fluent_weather_moon_24_regular.svg?raw";
import translateSvg from "../../assets/icons/fluent/ic_fluent_translate_24_regular.svg?raw";
import localLanguageSvg from "../../assets/icons/fluent/ic_fluent_local_language_24_regular.svg?raw";
import checkboxCheckedSvg from "../../assets/icons/fluent/ic_fluent_checkbox_checked_24_regular.svg?raw";
import checkboxUncheckedSvg from "../../assets/icons/fluent/ic_fluent_checkbox_unchecked_24_regular.svg?raw";
import infoSvg from "../../assets/icons/fluent/ic_fluent_info_24_regular.svg?raw";
import arrowLeftSvg from "../../assets/icons/fluent/ic_fluent_arrow_left_24_regular.svg?raw";
import arrowEnterLeftSvg from "../../assets/icons/fluent/ic_fluent_arrow_enter_left_24_regular.svg?raw";
import personSvg from "../../assets/icons/fluent/ic_fluent_person_24_regular.svg?raw";
import arrowClockwiseSvg from "../../assets/icons/fluent/ic_fluent_arrow_clockwise_24_regular.svg?raw";
import speakerOnSvg from "../../assets/icons/fluent/ic_fluent_speaker_2_24_regular.svg?raw";
import speakerOffSvg from "../../assets/icons/fluent/ic_fluent_speaker_mute_24_regular.svg?raw";
import moreVerticalSvg from "../../assets/icons/fluent/ic_fluent_more_vertical_24_regular.svg?raw";

type IconProps = {
  size?: number;
  style?: string | Record<string, string | number>;
  class?: string;
  className?: string;
};

function prepareSvg(raw: string, size: number): string {
  return raw
    .replace(/#212121/gi, "currentColor")
    .replace("<svg", `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false"`);
}

function makeFluentIcon(raw: string) {
  return function FluentIcon({ size = 20, style, class: cls, className }: IconProps) {
    return (
      <span
        class={cls ?? className}
        style={style}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: prepareSvg(raw, size) }}
      />
    );
  };
}

export const Eye = makeFluentIcon(eyeSvg);
export const EyeOff = makeFluentIcon(eyeOffSvg);
export const ChevronLeft = makeFluentIcon(chevronLeftSvg);
export const ChevronRight = makeFluentIcon(chevronRightSvg);
export const Dismiss = makeFluentIcon(dismissSvg);
export const Send = makeFluentIcon(sendSvg);
export const PersonCircleOff = makeFluentIcon(personCircleOffSvg);
export const ArrowRight = makeFluentIcon(arrowRightSvg);
export const ArrowExit = makeFluentIcon(arrowExitSvg);
export const Alert = makeFluentIcon(alertSvg);
export const ServiceBell = makeFluentIcon(serviceBellSvg);
export const WhisperIcon = makeFluentIcon(whisperSvg);
export const Copy = makeFluentIcon(copySvg);
export const Check = makeFluentIcon(checkSvg);
export const Filter = makeFluentIcon(filterSvg);
export const Moon = makeFluentIcon(moonSvg);
export const Translate = makeFluentIcon(translateSvg);
export const LocalLanguage = makeFluentIcon(localLanguageSvg);
export const CheckboxChecked = makeFluentIcon(checkboxCheckedSvg);
export const CheckboxUnchecked = makeFluentIcon(checkboxUncheckedSvg);
export const Info = makeFluentIcon(infoSvg);
export const ArrowLeft = makeFluentIcon(arrowLeftSvg);
export const ArrowEnterLeft = makeFluentIcon(arrowEnterLeftSvg);
export const Person = makeFluentIcon(personSvg);
export const ArrowClockwise = makeFluentIcon(arrowClockwiseSvg);
export const SpeakerOn = makeFluentIcon(speakerOnSvg);
export const SpeakerOff = makeFluentIcon(speakerOffSvg);
export const MoreVertical = makeFluentIcon(moreVerticalSvg);
