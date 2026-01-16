import { Page, Card, Text, BlockStack } from '@shopify/polaris';

export default function Dashboard() {
    return (
        <Page title="Dashboard">
            <Card>
                <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Welcome to Mexican Golf Cart Admin</Text>
                    <Text as="p">Use the sidebar to manage Bookings, Inventory, Products, and Locations.</Text>
                </BlockStack>
            </Card>
        </Page>
    );
}
