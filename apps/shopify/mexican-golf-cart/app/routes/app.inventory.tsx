import { Page, Layout, Card, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function InventoryPage() {
    return (
        <Page>
            <TitleBar title="Inventory" />
            <Layout>
                <Layout.Section>
                    <Card>
                        <Text as="p" variant="bodyMd">
                            Inventory page placeholder.
                        </Text>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
