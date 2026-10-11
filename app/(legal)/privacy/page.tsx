import { SUPPORT_EMAIL } from "@/lib/site";
import {
  Clause,
  ContactCard,
  LegalHeader,
  TableOfContents,
} from "../_components";

export const metadata = { title: "Privacy Policy — Quota" };

const SECTIONS = [
  { n: 1, title: "What we collect" },
  { n: 2, title: "What we never collect" },
  { n: 3, title: "How we use it" },
  { n: 4, title: "Sharing" },
  { n: 5, title: "Retention & deletion" },
];

export default function PrivacyPage() {
  return (
    <>
      <LegalHeader
        eyebrow="Legal"
        title="Privacy Policy"
        summary="What we collect, what we never touch, and how to have it all deleted. No surprises."
      />

      <div className="grid gap-12 lg:grid-cols-[1fr_15rem] lg:gap-16">
        <article>
          <Clause n={1} title="What we collect">
            <p>
              When you sign in through Auth0, we receive your basic account
              information — your name and email address. As you use Quota, we
              store the business data you create: your business name and contact
              details, your work catalog, your quotes, the payments you record
              against them, and your business logo if you upload one. When you
              email a quote, our email provider Resend gives us delivery metadata
              (whether the message was delivered, bounced, or opened) so we can
              show you send status.
            </p>
            <p>
              <strong>Your clients&apos; details.</strong> When you add a client,
              you give us their name and, if you enter them, their email address,
              phone number and postal address. That information belongs to your
              clients, not to us — we hold it on your behalf so we can put it on
              your quotes and send them where you tell us to. We do not market to
              your clients, and we do not use their details for anything other
              than producing and delivering the quotes you create.
            </p>
          </Clause>

          <Clause n={2} title="What we never collect">
            <p>
              We never see or store your card number. When you add a card, the
              card fields on that page are served directly by Stripe and the
              details go straight from your browser to Stripe — they never reach
              our servers. All we receive back is a reference to the saved card
              held at Stripe, along with your subscription status: which plan
              you&apos;re on and whether it&apos;s active.
            </p>
          </Clause>

          <Clause n={3} title="How we use it">
            <p>
              We use your data for one purpose: running the service. Your catalog
              and contacts power your quotes, and your email address is used to
              sign you in and send you service messages. We also keep basic usage
              records — IP address, browser type, and access dates — for security
              and abuse prevention.
            </p>
          </Clause>

          <Clause n={4} title="Sharing">
            <p>
              We never sell your data. It is shared only with the providers that
              run the service on our behalf: <strong>Auth0</strong> (Okta) for
              sign-in, <strong>Stripe</strong> for billing, <strong>Resend</strong>{" "}
              for email delivery, <strong>Supabase</strong> for database hosting,
              and <strong>Vercel</strong> for application hosting and server logs.
              Each of them processes your data only to perform their part of the
              service.
            </p>
            <p>
              When you email a quote, the recipient&apos;s address is passed to
              Resend so the message can be delivered, and appears in our server
              logs at Vercel as part of the delivery record.
            </p>
          </Clause>

          <Clause n={5} title="Retention & deletion">
            <p>
              We keep your data for as long as your account is active, so your
              quotes and client history are there when you need them. That
              includes the security records described above — IP address, browser
              type and access dates — which we retain for the life of the account
              rather than for a fixed window.
            </p>
            <p>
              You can ask us to delete your account and everything in it, or to
              send you a copy of your data, by emailing{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We will
              action it within 30 days. Deletion removes your account, your
              catalog, your quotes, your recorded payments and your clients&apos;
              contact details from our systems and from Auth0; records Stripe is
              required to keep for financial reporting remain with Stripe.
            </p>
          </Clause>

          <ContactCard heading="Questions about your data?">
            Ask us anything about this policy or request a full export or
            deletion.
          </ContactCard>
        </article>

        <TableOfContents items={SECTIONS} />
      </div>
    </>
  );
}
