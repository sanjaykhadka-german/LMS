import { redirect } from "next/navigation";
export default function RawMaterialsPage() {
  redirect("/items?type=raw_material");
}
