// const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

// const api = new WooCommerceRestApi({
//   url: "https://advanced.gg",
//   consumerKey: "ck_ddb8afcc1afec478aca5a99db60d7f0b786ffe34",
//   consumerSecret: "cs_e960108a4316b45777a44f045458930357f2c691",
//   version: "wc/v3",
// });

// let arr = [];

// const getAllCoupons = (page) => {
//   api
//     .get("coupons", { page: page, per_page: 100 })
//     .then((res) => {
//       const data = res.data;
//       data.forEach((ele) => {
//         ele.meta_data.forEach((meta) => {
//           if (meta.key === "affwp_discount_affiliate") {
//             ele.awpID = meta.value;
//             arr.push(ele);
//           }
//         });
//       });
//       if (data.length > 0) {
//         getAllCoupons(page + 1);
//       }
//       console.log(arr.length);
//     })
//     .catch((err) => console.log(err));
// };

// // getAllCoupons(1);

// const url = `https://advanced.gg/wp-json/affwp/v1/affiliates/14?rate=0.02`;
// const config = {
//   headers: {
//     Accept: "application/json",
//     Authorization: `Basic ${token}`,
//   },
// };

// const partnersWithCoups = [];
// axios
//   .patch(url, config)
//   .then((res) => {
//     console.log(res.data);
//   })
//   .catch((err) => console.log(err));
