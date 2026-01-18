import { Page, Layout, Card, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function LocationsPage() {
    return (
        <Page>
            <TitleBar title="Locations" />
            <Layout>
                <Layout.Section>
                    <Card>
                        <Text as="p" variant="bodyMd">
                            Locations page placeholder.
                        </Text>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
