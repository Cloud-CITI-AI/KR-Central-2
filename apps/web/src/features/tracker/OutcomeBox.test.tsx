import type { JobDetail } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { delay, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { OutcomeBox } from "./OutcomeBox";
import { syntheticJob } from "./test-fixtures";
import { renderTracker } from "./test-utils";
import { useJob } from "./useJob";

const box = () => screen.getByRole("group", { name: "WAPC outcome" });
const show = (job: JobDetail) => {
  const view = renderTracker(<OutcomeBox job={job} />);
  view.queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
  return view;
};
const timer = () => within(box()).getByRole("timer");

describe("OutcomeBox", () => {
  it("asks for the Conformance Notification or a conformed date while there is no outcome date, with no countdown", async () => {
    const { container } = show(syntheticJob());
    expect(timer()).toHaveTextContent(
      "Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown",
    );
    expect(timer()).toHaveAttribute("aria-live", "off");
    expect(within(timer()).queryByText(/until outcome date/)).toBeNull();
    expect(box()).toHaveTextContent("Stamped date on page 1 of the Conformance Notification");
    expect(box()).toHaveTextContent("90 days after the conformed date");
    await expectNoAxeViolations(container);
  });

  it("shows both dates, the automatic hint and the live countdown for an entered conformed date", async () => {
    const job = syntheticJob({
      fields: {
        conformedDate: "2026-03-16",
        outcomeDate: "2026-06-14",
        conformedSource: { method: "manual", fileName: null, stampText: null },
      },
    });
    const { container } = show(job);
    expect(screen.getByLabelText("Conformed date")).toHaveValue("2026-03-16");
    expect(screen.getByLabelText("WAPC outcome date")).toHaveValue("2026-06-14");
    expect(box()).toHaveTextContent("Entered by hand");
    expect(box()).toHaveTextContent("90 days after the conformed date");
    expect(screen.queryByRole("button", { name: /reset to 90 days/ })).toBeNull();
    expect(timer()).toHaveTextContent("Sun, 14 Jun 2026");
    await expectNoAxeViolations(container);
  });

  it("says where a read conformed date came from", () => {
    const named = syntheticJob({
      fields: {
        conformedDate: "2026-03-16",
        outcomeDate: "2026-06-14",
        conformedSource: { method: "stamp_annotation", fileName: "conformance notification.pdf", stampText: null },
      },
    });
    show(named);
    expect(box()).toHaveTextContent("Read from conformance notification.pdf");
  });

  it("says a read date came from the notification when the file name is gone", () => {
    const job = syntheticJob({
      fields: {
        conformedDate: "2026-03-16",
        outcomeDate: "2026-06-14",
        conformedSource: { method: "text", fileName: null, stampText: null },
      },
    });
    show(job);
    expect(box()).toHaveTextContent("Read from the Conformance Notification");
  });

  it("offers 'reset to 90 days' for an outcome date changed by hand, and resets it", async () => {
    const job = syntheticJob({ fields: { conformedDate: "2026-03-16", outcomeDate: "2026-07-01" } });
    const bodies: unknown[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...job, outcomeDate: "2026-06-14", version: 2 });
      }),
    );
    show(job);
    expect(box()).toHaveTextContent("Changed by hand (e.g. deferral)");
    await userEvent.click(screen.getByRole("button", { name: "· reset to 90 days" }));
    await waitFor(() => {
      expect(bodies).toEqual([{ outcomeDate: "2026-06-14" }]);
    });
  });

  it("has no reset link when there is no conformed date to count from, and none without job.edit", () => {
    const noConformed = syntheticJob({ fields: { outcomeDate: "2026-07-01" } });
    const view = show(noConformed);
    expect(box()).toHaveTextContent("Changed by hand (e.g. deferral)");
    expect(screen.queryByRole("button", { name: /reset/ })).toBeNull();
    view.unmount();
    const client = syntheticJob({
      role: "external",
      grantRole: "client",
      fields: { conformedDate: "2026-03-16", outcomeDate: "2026-07-01" },
    });
    show(client);
    expect(screen.queryByRole("button", { name: /reset/ })).toBeNull();
    expect(screen.getByLabelText("Conformed date")).toBeDisabled();
    expect(screen.getByLabelText("WAPC outcome date")).toBeDisabled();
  });

  it("saves an outcome date override and a conformed date with the right bodies", async () => {
    const job = syntheticJob();
    const bodies: unknown[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...job, version: 2 });
      }),
    );
    show(job);
    fireEvent.change(screen.getByLabelText("WAPC outcome date"), { target: { value: "2026-08-01" } });
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    fireEvent.change(screen.getByLabelText("Conformed date"), { target: { value: "2026-03-16" } });
    await waitFor(() => {
      expect(bodies).toHaveLength(2);
    });
    expect(bodies).toEqual([{ outcomeDate: "2026-08-01" }, { conformedDate: "2026-03-16" }]);
  });

  it("typing the conformed date digit by digit saves once, on leaving the field", async () => {
    const job = syntheticJob();
    const bodies: unknown[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...job, version: 2 });
      }),
    );
    show(job);
    const input = screen.getByLabelText("Conformed date");
    await userEvent.click(input);
    for (const year of ["0002", "0020", "0202", "2026"]) {
      fireEvent.keyDown(input, { key: "2" });
      fireEvent.change(input, { target: { value: `${year}-03-16` } });
    }
    expect(bodies).toEqual([]);
    await userEvent.tab();
    await waitFor(() => {
      expect(bodies).toEqual([{ conformedDate: "2026-03-16" }]);
    });
  });

  it("sets the outcome date 90 days after a conformed date entered by hand, and starts the countdown", async () => {
    const job = syntheticJob();
    function Live() {
      const { data } = useJob(job.id);
      return data ? <OutcomeBox job={data} /> : null;
    }
    server.use(
      mockApi("getJob", job),
      handlerFor("updateJob", () =>
        HttpResponse.json({
          ...job,
          conformedDate: "2026-03-16",
          conformedSource: { method: "manual", fileName: null, stampText: null },
          outcomeDate: "2026-06-14",
          version: 2,
        }),
      ),
    );
    renderTracker(<Live />);
    await screen.findByRole("group", { name: "WAPC outcome" });
    fireEvent.change(screen.getByLabelText("Conformed date"), { target: { value: "2026-03-16" } });
    await waitFor(() => {
      expect(screen.getByLabelText("WAPC outcome date")).toHaveValue("2026-06-14");
    });
    expect(
      await within(timer()).findByText("Outcome date passed – Sun, 14 Jun 2026", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("clearing the conformed date stops the countdown at once: the outcome date goes and the prompt returns", async () => {
    const job = syntheticJob({
      fields: {
        conformedDate: "2027-12-01",
        outcomeDate: "2028-02-29",
        conformedSource: { method: "manual", fileName: null, stampText: null },
      },
    });
    function Live() {
      const { data } = useJob(job.id);
      return data ? <OutcomeBox job={data} /> : null;
    }
    const bodies: unknown[] = [];
    server.use(
      mockApi("getJob", job),
      handlerFor("updateJob", async ({ request }) => {
        bodies.push(await request.json());
        await delay("infinite");
        return HttpResponse.json(job);
      }),
    );
    renderTracker(<Live />);
    await screen.findByRole("group", { name: "WAPC outcome" });
    expect(timer()).toHaveTextContent("Tue, 29 Feb 2028");
    fireEvent.change(screen.getByLabelText("Conformed date"), { target: { value: "" } });
    await waitFor(() => {
      expect(bodies).toEqual([{ conformedDate: null }]);
    });
    expect(screen.getByLabelText("WAPC outcome date")).toHaveValue("");
    expect(timer()).toHaveTextContent(
      "Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown",
    );
    expect(box()).toHaveTextContent("90 days after the conformed date");
    expect(box()).not.toHaveTextContent("Changed by hand");
  });
});
