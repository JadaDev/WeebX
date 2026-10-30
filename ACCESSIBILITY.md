# Accessibility

WeebX is an open-source web hosting stack manager for Windows, developed by **JadaDev**.

We believe that software development and website management should be accessible to everyone, including people who use assistive technologies, rely on keyboard navigation, or have visual, hearing, motor, or cognitive disabilities.

Our goal is to make WeebX straightforward, understandable, and usable for developers, administrators, beginners, and contributors with different needs and abilities.

This document explains our accessibility priorities, expectations for contributors, how to report accessibility barriers, and how we plan to improve accessibility over time.

Accessibility is an ongoing responsibility. We welcome feedback and contributions that help make WeebX better for everyone.

- **Website:** https://weebx.jadadev.com/
- **GitHub:** https://github.com/JadaDev/WeebX
- **License:** MIT

## Priorities

WeebX aims to provide an accessible experience across its desktop application, public website, documentation, and installation process.

Our accessibility priorities include:

### Keyboard accessibility

- Make interactive controls usable without requiring a mouse.
- Support logical keyboard navigation throughout the interface.
- Provide visible keyboard focus indicators.
- Allow users to operate buttons, forms, dialogs, settings, and navigation using standard keyboard controls.
- Avoid keyboard traps that prevent users from leaving an interface element.
- Ensure important actions do not depend exclusively on dragging, hovering, or other pointer-specific interactions.

### Screen readers and assistive technologies

- Provide meaningful names and descriptions for interactive elements.
- Use appropriate semantic elements and accessibility attributes.
- Ensure form fields have clear labels and associated instructions.
- Communicate important status changes, errors, and warnings in ways assistive technologies can interpret.
- Avoid relying exclusively on icons, colors, or animations to communicate information.

### Visual accessibility

- Maintain readable text and sufficient contrast between foreground and background elements.
- Support Windows display scaling and text enlargement where practical.
- Keep layouts usable at different application window sizes.
- Ensure important information remains understandable without relying on color alone.
- Provide clear visual distinctions between interactive, disabled, selected, and focused elements.

### Motion and animation

WeebX includes animated dashboard elements that communicate service activity.

The application already documents support for reduced-motion preferences in its service-status visualization.

We aim to respect reduced-motion preferences throughout the interface and avoid unnecessary animations that could cause discomfort or interfere with usability.

Important information must remain available when animations are reduced or disabled.

### Clear content and communication

- Use simple, consistent language.
- Explain technical settings where additional context is helpful.
- Display actionable error messages instead of unexplained technical failures.
- Clearly distinguish development settings from production settings.
- Make security warnings understandable without relying only on color.
- Provide instructions for potentially disruptive actions, such as changing permissions, restarting services, or modifying configurations.

### Accessibility standards

WeebX uses the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA as an **aspirational accessibility target** for relevant web-based interfaces.

This is a development goal, not a claim of verified compliance.

WeebX has not undergone a documented comprehensive accessibility evaluation establishing WCAG conformance.

Accessibility improvements will be introduced progressively as the project develops.

## Contributor expectations

Everyone contributing to WeebX is encouraged to consider accessibility when developing, modifying, or reviewing user-facing features.

Accessibility should be considered during implementation rather than treated solely as a final review step.

### Interface contributions

Contributors should:

1. Use semantic HTML elements wherever appropriate.
2. Ensure interactive elements are keyboard accessible.
3. Provide accessible labels for buttons, inputs, icons, and controls.
4. Maintain logical navigation and focus order.
5. Ensure dialogs can be opened, operated, and dismissed using a keyboard.
6. Avoid communicating information through color alone.
7. Respect reduced-motion preferences.
8. Keep error messages clear and understandable.
9. Avoid unnecessary complexity in forms and settings.
10. Ensure changes remain usable at different window sizes and display scaling settings.

### Testing expectations

For user-facing changes, contributors should test relevant interactions using:

- Keyboard-only navigation.
- Windows display scaling and text enlargement.
- Light and dark interface conditions, where applicable.
- Reduced-motion settings when animations are involved.
- Screen readers, such as Windows Narrator or NVDA, when available and relevant.

Contributors should document any accessibility testing performed and identify limitations that remain.

Testing with assistive technologies is encouraged, but contributors should not claim compatibility with combinations they have not evaluated.

### Automated checks

The repository currently documents the following development checks:

```bash
npm run typecheck
npm test
npm run build
```

Contributors should run these commands before submitting changes, following the project's `CONTRIBUTING.md`.

These checks help verify application quality but do not, by themselves, establish accessibility compliance.

Dedicated automated accessibility testing is a potential future improvement. Until such checks are introduced and documented, contributors should perform relevant manual accessibility checks.

### Pull requests

Pull requests containing user-facing changes should explain:

- What changed and which users are affected.
- Whether the feature can be operated using a keyboard.
- Whether labels, focus behavior, or status announcements changed.
- Which accessibility checks were performed.
- Any known accessibility limitations.

Screenshots and recordings may be included but are not required.

Accessibility regressions should be addressed before merging whenever reasonably possible.

## Reporting accessibility issues

If you experience an accessibility barrier while using WeebX, we encourage you to report it.

You do not need to be an accessibility expert or disclose a disability to report a problem.

**Report an issue through GitHub:**

https://github.com/JadaDev/WeebX/issues/new

When submitting a report, use a descriptive title, such as:

`[Accessibility] Cannot navigate PHP settings using keyboard`

If possible, include:

- The WeebX version you are using.
- The affected feature, screen, or website URL.
- What you were trying to accomplish.
- What happened instead.
- What you expected to happen.
- Your Windows version or browser.
- Your input method, such as keyboard, mouse, or touch.
- Any assistive technology used, if relevant.
- Steps that could help reproduce the issue.

Screenshots, recordings, and diagnostic information are optional.

Please do not include passwords, private database information, API keys, or other sensitive data in public reports.

If GitHub itself presents an accessibility barrier, you may contact the project maintainer through an available contact method published on the official WeebX website or GitHub profile.

Security vulnerabilities should be reported using the process described in [SECURITY.md](SECURITY.md), rather than through a public accessibility issue.

## Severity

Accessibility reports may be categorized by their impact on the user's ability to complete a task.

Reporters do not need to select a severity level. Project maintainers can assess the impact during review.

### Critical

A barrier completely prevents access to an essential feature without a reasonable workaround.

Examples:

- A keyboard-only user cannot complete initial setup.
- A user cannot start or stop essential services because controls are inaccessible.
- A blocking dialog cannot be dismissed using available input methods.

### High

A major feature is difficult or impossible to use for some users, but a workaround may exist.

Examples:

- Important settings cannot be accessed using keyboard navigation.
- Screen readers cannot identify essential form controls.
- Important warnings are communicated only through color.

### Medium

An accessibility issue creates significant inconvenience but does not completely prevent task completion.

Examples:

- Focus indicators are difficult to see.
- Some status messages are not announced to assistive technologies.
- Text becomes difficult to read at increased display scaling.

### Low

A minor accessibility issue affects comfort, clarity, or consistency without substantially preventing use.

Examples:

- Decorative images lack appropriate alternative handling.
- Minor interface elements have inconsistent focus styling.
- Help text could be clearer or more descriptive.

Severity may change as additional information becomes available.

## How we respond

Accessibility reports are reviewed by the WeebX maintainers as part of normal project maintenance.

Our intended process is:

1. **Review:** Understand the reported barrier and identify the affected functionality.
2. **Reproduce:** Attempt to reproduce the issue using the provided information.
3. **Prioritize:** Evaluate the impact on users and assign an appropriate priority.
4. **Investigate:** Identify a suitable fix or an available workaround.
5. **Implement:** Address the issue through a code, design, or documentation change.
6. **Verify:** Test the solution and, when possible, invite the reporter to confirm the improvement.

We aim to prioritize issues that prevent users from installing WeebX, managing services, accessing settings, or completing essential tasks.

Response and resolution times depend on issue complexity, maintainer availability, and project priorities.

We do not currently guarantee fixed response or resolution deadlines.

When possible, progress and relevant workarounds will be communicated through the associated GitHub issue.

## Ownership and maintenance

Accessibility is maintained by the **JadaDev / WeebX project maintainers**, with support from community contributors.

Maintainer responsibilities include:

- Reviewing accessibility reports.
- Prioritizing accessibility improvements.
- Considering accessibility during feature development.
- Reviewing accessibility-related pull requests.
- Maintaining this document.
- Documenting known barriers and available workarounds.
- Encouraging accessible development practices.

Accessibility considerations should be included during major interface changes and release preparation.

This statement should be reviewed when significant changes affect the application's interface, supported platforms, or accessibility practices, and periodically as maintenance capacity allows.

If project ownership changes, responsibility for accessibility documentation and outstanding accessibility issues should transfer to the new maintainers.

## Supported environments

### Desktop application

WeebX is designed for:

- Windows 10, 64-bit.
- Windows 11, 64-bit.

The application uses Electron and a React-based interface.

The following accessibility-related environments are priorities for evaluation:

| Environment | Status |
|---|---|
| Windows 10 x64 | Supported application platform |
| Windows 11 x64 | Supported application platform |
| Keyboard navigation | Accessibility priority; full coverage not verified |
| Mouse input | Standard desktop interaction |
| Windows display scaling | Evaluation target |
| Windows Narrator | Compatibility not comprehensively verified |
| NVDA screen reader | Compatibility not comprehensively verified |
| Reduced-motion preferences | Documented for dashboard service visualization |
| Touch interaction | Not comprehensively evaluated |

### Public website

The official website is available at:

https://weebx.jadadev.com/

We aim to support modern browsers, including:

- Google Chrome.
- Microsoft Edge.
- Mozilla Firefox.
- Safari, where platform compatibility permits.

This list describes intended browser coverage, not a verified compatibility matrix.

Browser versions, screen reader combinations, mobile layouts, and assistive technology support have not been comprehensively evaluated.

### Third-party interfaces

WeebX integrates with external components such as Apache, PHP, MariaDB, and phpMyAdmin.

Some functionality may open external tools, native Windows dialogs, or third-party interfaces.

Accessibility behavior within these components may differ from the main WeebX application and can depend on the relevant software provider.

We welcome reports when these integrations create barriers in the overall WeebX workflow.

## Known limitations

WeebX is actively developed, and its accessibility coverage is still being evaluated.

As of October 2026, the project has not published a comprehensive accessibility audit covering every screen, workflow, and supported environment.

The following areas require further evaluation and should not be considered confirmed defects without testing:

### Keyboard navigation

Complete keyboard accessibility has not been verified across every dashboard control, settings panel, dialog, and advanced configuration workflow.

Users encountering an inaccessible control are encouraged to report the affected screen and task.

### Screen reader compatibility

Complete compatibility with Windows Narrator, NVDA, and other assistive technologies has not been verified.

This includes announcements for service status, validation errors, progress indicators, and dynamically updated content.

### Display scaling

Some interface layouts may require additional testing at higher Windows display scaling levels or smaller window sizes.

Users who encounter clipped text, hidden controls, or difficult navigation should report the affected screen and display settings.

### Dynamic information

WeebX displays changing information such as service status, progress, warnings, logs, and connection details.

These interactions require continued accessibility evaluation to ensure updates are understandable without relying exclusively on visual changes.

### Third-party content

Third-party administration tools and websites may have accessibility limitations outside the direct control of WeebX.

Where practical, WeebX should provide clear navigation and guidance for accessing these tools.

### Available workarounds

Depending on the issue, users may be able to use Windows accessibility features, display scaling, keyboard shortcuts, or an alternative administrative workflow.

A workaround should not be treated as a permanent substitute for fixing an accessibility barrier.

Confirmed issues and their workarounds should be documented in the project's GitHub issue tracker.

**Known issues and reports:**

https://github.com/JadaDev/WeebX/issues

The absence of a reported issue does not mean that an accessibility barrier does not exist.

## Feedback and improvements

Accessibility improves through feedback, testing, and contributions from people with different experiences and needs.

We welcome suggestions related to:

- Keyboard navigation.
- Screen reader support.
- Visual readability and contrast.
- Reduced-motion behavior.
- Clearer instructions and error messages.
- More accessible installation and configuration workflows.
- Better accessibility documentation.
- Automated accessibility testing.
- Improved support for Windows accessibility features.

You can suggest an improvement, report an accessibility barrier, or propose a change through the GitHub repository:

https://github.com/JadaDev/WeebX/issues

Contributors may also submit pull requests:

https://github.com/JadaDev/WeebX/pulls

Changes to this accessibility statement are welcome when they improve clarity, accuracy, or usefulness.

We appreciate everyone who helps make WeebX easier to use.

---

**Maintained by:** JadaDev / WeebX Contributors  
**Project:** WeebX  
**Website:** https://weebx.jadadev.com/  
**Repository:** https://github.com/JadaDev/WeebX  
**Last updated:** October 30, 2026

*Accessibility is not a one-time feature. It is part of building better software for everyone.*
