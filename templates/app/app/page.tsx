import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
  ThemeModeToggle,
} from '@hearthkit/ui'

/**
 * Home page. Replace it with your own — it exists to prove the wiring end to end: the layout
 * primitives, a themed component, and the theme toggle all come from `@hearthkit/ui`, and the
 * Playwright smoke test asserts they render with real styles applied.
 */
export default function HomePage() {
  return (
    <PageContainer>
      <PageHeader
        pageTitle="hearthkit app"
        pageDescription="Everything below comes from @hearthkit/ui. Start building by editing app/page.tsx."
      >
        <ThemeModeToggle />
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>Themed and ready</CardTitle>
          <CardDescription>
            Tokens come from the hearthkit theme, utilities from Tailwind, and dark mode from the
            toggle in the header. Override any token in app/globals.css.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button>Primary action</Button>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
