import { legal } from "@/lib/legal";
import { services } from "@/lib/services";
import { site } from "@/lib/site";

/**
 * Структуровані дані schema.org для публічних сторінок.
 * Усі URL — абсолютні: цього вимагають Google та інші пошукові системи.
 */

export const organizationId = `${site.url}/#organization`;
export const websiteId = `${site.url}/#website`;

const serviceUrl = (id: string) => `${site.url}/services#${id}`;

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": organizationId,
    name: site.name,
    alternateName: site.shortName,
    url: site.url,
    description: site.description,
    logo: `${site.url}/icon.svg`,
    image: `${site.url}/opengraph-image`,
    areaServed: { "@type": "Country", name: "Україна" },
    knowsLanguage: ["uk"],
    ...(legal.contactEmail
      ? {
          email: legal.contactEmail,
          contactPoint: [
            {
              "@type": "ContactPoint",
              contactType: "sales",
              email: legal.contactEmail,
              availableLanguage: ["uk"],
            },
          ],
        }
      : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Послуги BONSI Studios",
      itemListElement: services.map((service) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: service.title,
          description: service.summary,
          url: serviceUrl(service.id),
          provider: { "@id": organizationId },
        },
      })),
    },
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteId,
    url: site.url,
    name: site.name,
    description: site.description,
    inLanguage: "uk-UA",
    publisher: { "@id": organizationId },
  };
}

export function servicesJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Послуги BONSI Studios",
    itemListElement: services.map((service, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Service",
        name: service.title,
        description: service.summary,
        url: serviceUrl(service.id),
        provider: { "@id": organizationId },
      },
    })),
  };
}

export function faqJsonLd(items: readonly { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${site.url}${item.path}`,
    })),
  };
}
