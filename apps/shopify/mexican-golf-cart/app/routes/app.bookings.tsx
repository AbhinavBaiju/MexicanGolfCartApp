import { Page, Layout, Card, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function BookingsPage() {
    return (
        <Page>
            <TitleBar title="Bookings" />
            <Layout>
                <Layout.Section>
                    <Card>
                        <Text as="p" variant="bodyMd">
                            Bookings page placeholder.
                        </Text>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
