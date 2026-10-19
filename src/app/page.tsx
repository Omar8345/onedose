import { CareDashboard } from "@/components/care-dashboard";
import { demoCircle } from "@/lib/demo-data";

export default function Home() {
  return <CareDashboard circle={demoCircle} />;
}
