import {
  Clause,
  ContactCard,
  LegalHeader,
  Link,
  TableOfContents,
} from "../_components";

export const metadata = { title: "Terms of Service — Quota" };

const SECTIONS = [
  { n: 1, title: "The service" },
  { n: 2, title: "Accounts & plans" },
  { n: 3, title: "One account, one business" },
  { n: 4, title: "Acceptable use" },
  { n: 5, title: "Your content" },
  { n: 6, title: "Disclaimer" },
  { n: 7, title: "Limitation of liability" },
  { n: 8, title: "Cancellation & refunds" },
  { n: 9, title: "Changes" },
  { n: 10, title: "Governing law" },
];

export default function TermsPage() {
  return (
    <>
      <LegalHeader
        eyebrow="Legal"
        title="Terms of Service"
        summary="The agreement between your business and Quota — in plain language, section by section."
      />

      <div className="grid gap-12 lg:grid-cols-[1fr_15rem] lg:gap-16">
        <article>
          <Clause n={1} title="The service">
            <p>
              Quota is a quoting and invoicing tool built for contractors. You
              keep a catalog of the work you do and what you charge for it, build
              quotes from that catalog, email them to your clients as PDF
              invoices, and track which quotes have been paid. By creating an
              account, you agree to these terms.
            </p>
          </Clause>

          <Clause n={2} title="Accounts & plans">
            <p>
              Quota offers three plans: Free (3 quotes per month), Pro at
              $15/month (15 quotes per month), and Ultimate at $29/month
              (unlimited quotes). Paid subscriptions are billed monthly and
              processed by Stripe; Quota never stores your card details. You are
              responsible for keeping your login credentials secure and for all
              activity under your account.
            </p>
          </Clause>

          <Clause n={3} title="One account, one business">
            {/* prettier-ignore */}
            <p>Your account is licensed to a single business and its owner. Sharing login credentials with anyone outside your business — on any plan, including Ultimate — is a violation of these terms and grounds for suspension or termination.</p>
          </Clause>

          <Clause n={4} title="Acceptable use">
            <p>
              You may only use Quota for lawful purposes. Do not use the email
              sending features to send spam or unsolicited mail, and do not
              attempt to circumvent plan limits — for example by creating
              multiple accounts for the same business. We may suspend accounts
              that abuse the service.
            </p>
          </Clause>

          <Clause n={5} title="Your content">
            <p>
              Your quotes, client contacts, and work catalog remain yours. We
              store this data solely to provide the service to you, and we claim
              no ownership over any of it. If you delete your account, we delete
              your data as described in our{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </Clause>

          <Clause n={6} title="Disclaimer">
            <p>
              The service is provided &quot;as is&quot;, without any warranty of
              uninterrupted or error-free operation. The quotes and invoices you
              create are your business documents — you are responsible for
              verifying amounts, taxes, and terms before sending them to a
              client.
            </p>
          </Clause>

          <Clause n={7} title="Limitation of liability">
            <p>
              To the maximum extent permitted by law, Quota&apos;s total
              liability for any claim arising out of your use of the service is
              capped at the fees you paid us in the 3 months prior to the claim.
              We are not liable for indirect or consequential damages, including
              lost profits or lost business.
            </p>
          </Clause>

          <Clause n={8} title="Cancellation & refunds">
            <p>
              You can cancel your subscription at any time from the billing
              portal. Refunds are handled under our{" "}
              <Link href="/refunds">Refund Policy</Link>, which includes a full
              refund for any charge you cancel within 3 days.
            </p>
          </Clause>

          <Clause n={9} title="Changes">
            <p>
              We may update these terms from time to time as the service
              evolves. When we do, we will update the date at the top of this
              page. Continued use of Quota after a change means you accept the
              updated terms.
            </p>
          </Clause>

          <Clause n={10} title="Governing law">
            {/* prettier-ignore */}
            <p>These terms are governed by the laws of the State of New Jersey, USA.</p>
          </Clause>

          <ContactCard heading="Questions about these terms?">
            Email us and a real person will get back to you.
          </ContactCard>
        </article>

        <TableOfContents items={SECTIONS} />
      </div>
    </>
  );
}
