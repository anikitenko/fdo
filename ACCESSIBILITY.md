# Accessibility

FDO aims to make its desktop workspace, CLI, documentation, and website usable
by people with different access needs. Accessibility improvements and reports
are welcome throughout development, including before the first stable release.

This document describes the project's goals and contribution guidance. It is
not a certification of accessibility or a claim that every interface works with
every assistive technology.

## Scope and current limitations

Accessibility includes the Electron desktop app, plugin management, editor,
Live UI, dialogs, notifications, terminal workflows, and the public website.
Plugin authors are responsible for the interfaces they create; using the FDO
SDK alone does not guarantee an accessible plugin.

Behavior can differ across operating systems, browsers, screen readers, and
embedded components such as Monaco and the terminal. Test the actual affected
workflow rather than assuming that a component library or a passing automated
test establishes accessibility.

## Report an accessibility barrier

Open a [bug report](https://github.com/anikitenko/fdo/issues/new?template=bug_report.yml)
and mention accessibility in the title. Include whichever details help reproduce
the barrier:

- The FDO version or website page, operating system, and browser where relevant.
- The affected screen, plugin, or command and the task you wanted to complete.
- Steps to reproduce, expected behavior, and what prevented completion.
- Assistive technology and version, if relevant and you are comfortable sharing.
- Input method, zoom/text settings, and any workaround that helped.

Screenshots or recordings are optional. You do not need to disclose a diagnosis,
disability, or other personal information. Remove credentials and private data
from attachments. If you prefer a private report, email
[me@alexvwan.me](mailto:me@alexvwan.me). For a security vulnerability, follow the
[security policy](SECURITY.md) instead.

Reports will be reviewed as part of normal maintenance, with attention to
barriers that prevent completing essential tasks. Response and remediation
times depend on maintainer availability and the scope of the issue.

## Guidance for contributors and plugin authors

- Use semantic HTML and native controls where possible. Give interactive
  elements clear accessible names; associate fields with labels and errors.
- Make essential actions usable with a keyboard. Provide visible focus,
  sensible navigation order, and predictable dialog focus handling. Avoid
  keyboard traps and interactions available only on hover or through dragging.
- Keep text readable when zoomed or enlarged. Check smaller viewports and
  avoid clipping controls or hiding essential information.
- Use sufficient text and control contrast. Do not communicate state or errors
  through color alone; include text or another distinguishable indicator.
- Provide useful alternatives for meaningful images. For charts, include a
  textual summary or accessible data table and make important values available
  without relying on a pointer.
- Respect reduced-motion preferences for nonessential animation. Avoid flashing
  effects and preserve a usable interface when animation is disabled.
- Announce important status changes appropriately without repeatedly interrupting
  users. Keep notifications and validation messages understandable and actionable.
- For CLI changes, retain useful text output, explicit errors and exit statuses,
  documented commands, and structured output where supported. Do not rely only
  on color, symbols, or interactive prompts to explain a result.

## Review accessibility changes

Reproduce the reported barrier and verify the complete task after the change.
For affected graphical interfaces, check keyboard operation, focus visibility,
labels, error states, and resizing. Use an appropriate screen reader when the
change affects accessible names, reading order, focus, or announcements.

For website changes, check desktop and mobile layouts, enlarged text, and
reduced-motion settings. Automated checks can help find issues but do not replace
manual interaction or assistive-technology testing.

In a pull request, describe the barrier, the resulting behavior, and the
environments and tools you tested. Identify checks you could not run. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, test commands, and review expectations.
