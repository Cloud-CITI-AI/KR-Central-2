const CONTROLS =
  "button:not(:disabled), a[href], input:not(:disabled):not([type='hidden']), textarea:not(:disabled), select:not(:disabled)";
const UPLOAD_OR_TEXT = "input[type='file']:not(:disabled), textarea:not(:disabled)";

/** Focuses `element`, making it focusable by script only (`tabindex="-1"`) when it is not a control. */
function focusIt(element: HTMLElement): void {
  if (!element.matches(CONTROLS) && !element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.focus();
}

/**
 * Where keyboard focus goes when the row that has it is about to be removed (WCAG 2.4.3: focus must not be dropped on the page body).
 * The first control of the next row, else of the previous one; with no other row, the list's drop zone or text box, else any other
 * control beside the list, else the list's container itself. Call it from the handler that confirms the removal, while the row is
 * still in the document.
 */
export function focusAfterRemoval(row: HTMLElement): void {
  const sibling = row.nextElementSibling ?? row.previousElementSibling;
  if (sibling instanceof HTMLElement) {
    focusIt(sibling.querySelector<HTMLElement>(CONTROLS) ?? sibling);
    return;
  }
  const list = row.parentElement;
  const area = list?.parentElement;
  if (!list || !area) return;
  const outside = (selector: string) =>
    [...area.querySelectorAll<HTMLElement>(selector)].find((element) => !list.contains(element));
  focusIt(outside(UPLOAD_OR_TEXT) ?? outside(CONTROLS) ?? area);
}
