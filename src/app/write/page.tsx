import { Shell } from "@/components/shell";
import { Editor } from "@/components/editor";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { promptForDay } from "@/lib/services/entries";
import { dayKey } from "@/lib/day";

export const dynamic = "force-dynamic";

export default async function WritePage() {
  const user = await requireUser();
  const threads = await prisma.thread.findMany({
    where: { userId: user.id, status: { not: "archived" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const prompt = promptForDay(dayKey(new Date(), user.timezone));

  return (
    <Shell>
      <div className="rise">
        <p className="label mb-5">{prompt}</p>
        <Editor
          threads={threads}
          initial={{
            title: null,
            content: "",
            entryType: "daily",
            mood: null,
            occurredAt: new Date().toISOString(),
            location: null,
            isImportant: false,
            tags: [],
            threads: [],
          }}
        />
      </div>
    </Shell>
  );
}
