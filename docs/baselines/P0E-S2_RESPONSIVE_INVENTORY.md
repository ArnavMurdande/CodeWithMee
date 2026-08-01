# P0E-S2 responsive inventory

**Captured:** 2026-08-01  
**Supported widths:** 360, 390, 768, 1024 and 1440 CSS pixels

| Surface                         | Existing responsive behavior                                                                                           | P0E-S2 disposition                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Application header/dock         | Desktop nav becomes a bottom dock at 768 px.                                                                           | Retain; constrain the 390 px header/dock and reserve shell offsets.                     |
| Authentication/home             | Existing 480/600/768 px rules.                                                                                         | Retain; bound cards, copy and sections to the viewport.                                 |
| Dashboard                       | Grid stacks below 1200 px.                                                                                             | Retain; remove child minimum-width overflow and constrain typography.                   |
| Pathways                        | Existing stacked generator and bounded roadmap overlay, plus a blocking desktop recommendation.                        | Remove the warning; make overlays inset-based and all children shrinkable.              |
| Sandbox                         | Panes stack below 768 px; Monaco and output remain scrollable.                                                         | Correct inherited margins/widths and preserve explicit code scrolling.                  |
| Challenge catalog/create/solver | Catalog and forms have mobile rules; catalog displayed a blocking desktop warning; solver problem pane used 91% width. | Remove warning, keep table scrolling, use full-width panes and wrap actions.            |
| Courses                         | No responsive rules; viewer used a fixed 300 px sticky sidebar.                                                        | Add one-column cards and stacked static viewer navigation.                              |
| Space                           | Extensive 768 px rules and horizontal track controls.                                                                  | Retain; make cards/actions/min-widths and modals viewport-safe.                         |
| Profile                         | No responsive rules.                                                                                                   | Bound card, fields, typography and padding.                                             |
| Settings                        | Existing 768/480 px rules.                                                                                             | Retain; constrain form controls and section widths.                                     |
| Admin                           | Existing mobile layout and intentional 580 px table scroll surface.                                                    | Preserve semantic horizontal scrolling; remove duplicate header-offset padding.         |
| Provider compatibility UI       | CSS existed without breakpoints; route currently redirects while Phase 2 owns activation.                              | Add safe stacked CSS now without reactivating the retired provider route.               |
| Notes widget                    | Mobile FAB opened a “desktop only” popup and CSS hid the panel.                                                        | Use the same note workflow in a bounded mobile panel; drawing stays disabled on mobile. |

Horizontal scrolling is intentional only for code/editor output, explicit scroll-track controls and data tables. P0E-S6 will convert this source inventory into automated multi-viewport visual assertions; P0E-S2 does not claim browser screenshots for protected routes without a configured test identity/database.
