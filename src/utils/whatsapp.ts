export const openWhatsAppChat = () => {
  const phone = String(import.meta.env.VITE_WA_PHONE || "").replace(/\D/g, "");

  if (!phone) {
    alert("חסר מספר וואטסאפ בקובץ .env");
    return;
  }

  window.open(
    `https://wa.me/${phone}`,
    "_blank"
  );
};