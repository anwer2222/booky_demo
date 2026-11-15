"use client";

import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** Sends the user to Moyasar's payment page for an order. They come back to /?order=<id>. */
export function usePay() {
  const checkout = useAction(api.payments.checkout);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async (orderId: Id<"orders">) => {
    setPaying(true);
    setError(null);
    try {
      location.href = await checkout({ orderId });
    } catch (e) {
      const off = e instanceof ConvexError && e.data === "PAYMENTS_OFF";
      setError(off ? "الدفع غير مفعّل بعد في هذه النسخة التجريبية." : "تعذّر فتح صفحة الدفع، حاول مرة أخرى.");
      setPaying(false);
    }
  };
  return { pay, paying, error };
}
