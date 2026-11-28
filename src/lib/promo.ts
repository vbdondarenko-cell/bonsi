/**
 * Зимова акція «−40%»: з 6 грудня (День святого Миколая) по 2 січня включно (за київським часом).
 * Поза цим вікном сайт виглядає як зазвичай. `?promo=1` вмикає акційний вигляд для перегляду, `?promo=0` — вимикає.
 */
export const PROMO_DISCOUNT = 40;
export const PROMO_START = { month: 12, day: 6 } as const;
export const PROMO_END = { month: 1, day: 2 } as const;

/** Чи потрапляє дата в акційне вікно (місяць 1–12). Перехід через Новий рік враховано. */
export function isPromoWindow(month: number, day: number) {
  if (month === 12) return day >= PROMO_START.day;
  if (month === 1) return day <= PROMO_END.day;
  return false;
}

/** Кінець акції: 2 січня 23:59:59 за Києвом (UTC+2 узимку). Рік — найближчий січень. */
export function promoEndsAt(now: Date = new Date()) {
  const year = now.getMonth() === 0 ? now.getFullYear() : now.getFullYear() + 1;
  return new Date(`${year}-01-02T23:59:59+02:00`);
}

export function discounted(price: number) {
  return Math.round((price * (100 - PROMO_DISCOUNT)) / 100);
}

export function formatUah(value: number) {
  return `${value.toLocaleString("uk-UA").replace(/ /g, " ")} ₴`;
}

/** Скрипт, що ДО першого малювання виставляє html[data-promo="on"]. Рядок вставляється в <script> у layout. */
export const promoBootScript = `(function(){try{var d=document.documentElement;var q=location.search;var on=false;var n=new Date();var m=n.getMonth()+1,day=n.getDate();if(m===12&&day>=${PROMO_START.day})on=true;if(m===1&&day<=${PROMO_END.day})on=true;var s=null;try{s=sessionStorage.getItem("bonsi-promo")}catch(e){}if(/[?&]promo=1/.test(q)){on=true;try{sessionStorage.setItem("bonsi-promo","1")}catch(e){}}else if(/[?&]promo=0/.test(q)){on=false;try{sessionStorage.setItem("bonsi-promo","0")}catch(e){}}else if(s==="1")on=true;else if(s==="0")on=false;if(on)d.setAttribute("data-promo","on")}catch(e){}})()`;
