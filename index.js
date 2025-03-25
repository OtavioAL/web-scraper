const fs = require("fs");
const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let allProducts = new Map();
  let totalProducts = 0;
  let productsPerPage = 20;

  const createNewPage = async () => {
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (["image", "stylesheet", "font"].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("operationName=ProductsQuery")) {
        try {
          const jsonResponse = await response.json();

          if (
            !jsonResponse ||
            !jsonResponse.data ||
            !jsonResponse.data.search
          ) {
            return;
          }

          const { products } = jsonResponse?.data?.search;

          if (!products?.edges?.length) {
            return;
          }

          if (totalProducts === 0)
            totalProducts = products?.pageInfo?.totalCount || 0;

          products?.edges.forEach((product) => {
            if (product?.node?.id) {
              const productData = {
                id: product.node.id,
                name: product.node.brand?.name || product.node.name,
                price: product.node.offers?.lowPrice || "N/A",
                image: product.node?.image?.[0]?.url || "N/A",
              };

              allProducts.set(productData.id, productData);
            }
          });
        } catch (error) {}
      }
    });

    return page;
  };

  const mainPage = await createNewPage();
  await mainPage.goto(
    "https://mercado.carrefour.com.br/bebidas?category-1=bebidas&category-1=4599&facets=category-1&sort=score_desc&page=1",
    { waitUntil: "networkidle2" }
  );

  const totalPages = Math.ceil(totalProducts / productsPerPage);
  console.log(`Número de páginas estimadas: ${totalPages}`);

  const CONCURRENCY_LIMIT = 6;

  const processPage = async (pageNum) => {
    if (pageNum > totalPages) return;

    const page = await createNewPage();
    const url = `https://mercado.carrefour.com.br/bebidas?category-1=bebidas&category-1=4599&facets=category-1&sort=score_desc&page=${pageNum}`;
    console.log(`Carregando página ${pageNum}`);

    try {
      await page.goto(url, { waitUntil: "networkidle2" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {}

    await page.close();
  };

  for (let i = 1; i <= totalPages; i += CONCURRENCY_LIMIT) {
    const batch = [];
    for (let j = 0; j < CONCURRENCY_LIMIT && i + j <= totalPages; j++) {
      batch.push(processPage(i + j));
    }
    await Promise.all(batch);
  }
  fs.writeFileSync(
    "output.json",
    JSON.stringify([...allProducts.values()], null, 2)
  );
  console.log("💾 Arquivo output.json salvo com sucesso!");

  await browser.close();
})();
