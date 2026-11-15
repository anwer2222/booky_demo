// Amounts in SAR with the official Saudi riyal symbol (public/SR_sym.svg). The symbol is drawn as
// a CSS mask, so it takes the text colour. In RTL text it sits to the left of the number.

export function Price({ n }: { n: number }) {
  return (
    <span className="price">
      <bdi>{n.toLocaleString("ar-SA")}</bdi>
      <i className="sr" role="img" aria-label="ريال سعودي" />
    </span>
  );
}

const CARDS = [
  { src: "/payments/mada.svg", alt: "مدى" },
  { src: "/payments/visa.svg", alt: "فيزا" },
  { src: "/payments/mastercard.svg", alt: "ماستركارد" },
];

/** The cards Moyasar accepts, shown next to pay buttons. */
export function PaymentLogos() {
  return (
    <div className="pay-logos" aria-label="طرق الدفع المقبولة">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {CARDS.map((c) => <img key={c.src} src={c.src} alt={c.alt} />)}
    </div>
  );
}
