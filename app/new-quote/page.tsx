import { NewQuoteForm } from "@/components/quote";
import { requireUser } from "@/lib/auth";

export default async function NewQuotePage() {
  await requireUser();

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <p className="eyebrow mb-1">Write it up</p>
        <h1 className="font-display text-4xl font-bold uppercase">
          New Quote
        </h1>
      </div>
      <NewQuoteForm />
    </div>
  );
}
