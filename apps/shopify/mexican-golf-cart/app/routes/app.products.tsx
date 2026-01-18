import { Page, Layout, Card, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function ProductsPage() {
    return (
        <Page>
            <TitleBar title="Products" />
            <Layout>
                <Layout.Section>
                    <Card>
                        <Text as="p" variant="bodyMd">
                            Products page placeholder.
                        </Text>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
