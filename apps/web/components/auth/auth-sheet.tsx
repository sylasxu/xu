"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Loader2, LockKeyhole, Phone } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { writeClientToken } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";

type AuthSheetMode = "login" | "bind_phone";

type LoginResponse = {
  token: string;
  user?: {
    id?: string;
    nickname?: string | null;
    phoneNumber?: string | null;
  };
};

type AuthGateUi = {
  loginTitle: string;
  bindPhoneTitle: string;
  loginDescription: string;
  bindPhoneDescription: string;
  invalidPhoneText: string;
  missingCodeText: string;
  loginFailedText: string;
  phonePlaceholder: string;
  codePlaceholder: string;
  submitLabel: string;
  submittingLabel: string;
  privacyHint: string;
};

const DEFAULT_AUTH_GATE_UI: AuthGateUi = {
  loginTitle: "继续",
  bindPhoneTitle: "继续",
  loginDescription: "完成身份确认后会继续刚才的动作。",
  bindPhoneDescription: "完成手机号确认后会继续刚才的动作。",
  invalidPhoneText: "手机号格式不正确",
  missingCodeText: "请输入验证码",
  loginFailedText: "登录失败，请稍后再试",
  phonePlaceholder: "手机号",
  codePlaceholder: "验证码",
  submitLabel: "继续",
  submittingLabel: "处理中",
  privacyHint: "完成确认后会回到刚才的动作。",
};

const AUTH_GATE_UI_KEYS: Array<keyof AuthGateUi> = [
  "loginTitle",
  "bindPhoneTitle",
  "loginDescription",
  "bindPhoneDescription",
  "invalidPhoneText",
  "missingCodeText",
  "loginFailedText",
  "phonePlaceholder",
  "codePlaceholder",
  "submitLabel",
  "submittingLabel",
  "privacyHint",
];

type AuthSheetProps = {
  mode?: AuthSheetMode;
  trigger: ReactNode;
  isDarkMode?: boolean;
  reason?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAuthenticated?: (payload: LoginResponse) => void | Promise<void>;
};

function isAuthGateUi(value: unknown): value is AuthGateUi {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTH_GATE_UI_KEYS.every((key) => {
      const field = Reflect.get(value, key);
      return typeof field === "string" && field.trim().length > 0;
    })
  );
}

function isLoginResponse(value: unknown): value is LoginResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "token" in value &&
    typeof (value as { token?: unknown }).token === "string"
  );
}

function readErrorMessage(value: unknown, fallback: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "msg" in value &&
    typeof (value as { msg?: unknown }).msg === "string"
  ) {
    return (value as { msg: string }).msg;
  }

  return fallback;
}

export function AuthSheet({
  mode = "login",
  trigger,
  isDarkMode = false,
  reason,
  open,
  onOpenChange,
  onAuthenticated,
}: AuthSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ui, setUi] = useState<AuthGateUi>(DEFAULT_AUTH_GATE_UI);

  const controlledOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      setNotice(null);
      onOpenChange?.(nextOpen);
      if (open === undefined) {
        setInternalOpen(nextOpen);
      }
    },
    [onOpenChange, open]
  );

  useEffect(() => {
    if (!controlledOpen) {
      return;
    }

    let ignore = false;
    void fetch(`${API_BASE}/auth/ui`)
      .then((response) => response.json())
      .then((payload: unknown) => {
        if (!ignore && isAuthGateUi(payload)) {
          setUi(payload);
        }
      })
      .catch(() => {
        // 文案配置拉取失败时保留中性 fallback，不阻断登录动作。
      });

    return () => {
      ignore = true;
    };
  }, [controlledOpen]);

  const submit = useCallback(async () => {
    const normalizedPhone = phone.trim();
    const normalizedCode = code.trim();
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) {
      setNotice(ui.invalidPhoneText);
      return;
    }
    if (normalizedCode.length < 4) {
      setNotice(ui.missingCodeText);
      return;
    }

    setSubmitting(true);
    setNotice(null);

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grantType: "phone_otp",
          audience: "user",
          phone: normalizedPhone,
          code: normalizedCode,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isLoginResponse(payload)) {
        throw new Error(readErrorMessage(payload, `登录失败（${response.status}）`));
      }

      writeClientToken(payload.token);
      await onAuthenticated?.(payload);
      setOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ui.loginFailedText);
    } finally {
      setSubmitting(false);
    }
  }, [code, onAuthenticated, phone, setOpen, ui.invalidPhoneText, ui.loginFailedText, ui.missingCodeText]);

  const title = mode === "bind_phone" ? ui.bindPhoneTitle : ui.loginTitle;
  const description = reason || (mode === "bind_phone"
    ? ui.bindPhoneDescription
    : ui.loginDescription);

  return (
    <Dialog open={controlledOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={cn(
          "w-[calc(100vw-28px)] max-w-[390px] rounded-[28px] border p-0 shadow-[0_28px_80px_-42px_rgba(0,0,0,0.95)]",
          isDarkMode
            ? "border-white/10 bg-[#0B0B0B] text-white"
            : "border-black/10 bg-white text-black"
        )}
      >
        <div className="p-5">
          <DialogHeader className="space-y-3 text-left">
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-2xl border",
                isDarkMode ? "border-white/10 bg-white/[0.05]" : "border-black/10 bg-black/[0.04]"
              )}
            >
              {mode === "bind_phone" ? <Phone className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
            </div>
            <div className="space-y-2">
              <DialogTitle className="text-[20px] tracking-[-0.04em]">{title}</DialogTitle>
              <DialogDescription className={cn("text-sm leading-6", isDarkMode ? "text-white/58" : "text-black/54")}>
                {description}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="mt-5 space-y-3">
            <Input
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={ui.phonePlaceholder}
              className={cn(
                "h-12 rounded-2xl px-4 text-base shadow-none",
                isDarkMode
                  ? "border-white/10 bg-white/[0.04] text-white placeholder:text-white/30"
                  : "border-black/10 bg-black/[0.03] text-black placeholder:text-black/32"
              )}
            />
            <Input
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={ui.codePlaceholder}
              className={cn(
                "h-12 rounded-2xl px-4 text-base shadow-none",
                isDarkMode
                  ? "border-white/10 bg-white/[0.04] text-white placeholder:text-white/30"
                  : "border-black/10 bg-black/[0.03] text-black placeholder:text-black/32"
              )}
            />
          </div>

          {notice ? (
            <p className={cn("mt-3 text-sm", isDarkMode ? "text-amber-200/86" : "text-amber-700")}>{notice}</p>
          ) : null}

          <Button
            type="button"
            onClick={() => {
              void submit();
            }}
            disabled={submitting}
            className={cn(
              "mt-5 h-12 w-full rounded-2xl text-sm font-semibold",
              isDarkMode ? "bg-white text-black hover:bg-white/90" : "bg-black text-white hover:bg-black/90"
            )}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? ui.submittingLabel : ui.submitLabel}
          </Button>

          <p className={cn("mt-3 text-center text-[11px] leading-5", isDarkMode ? "text-white/34" : "text-black/36")}>
            {ui.privacyHint}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
