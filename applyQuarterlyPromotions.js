const axios = require("axios");
const dotenv = require("dotenv");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

dotenv.config();
const AWP_PUBLIC_KEY = `${process.env.AWP_PUBLIC_KEY}`; //awp username
const AWP_TOKEN = `${process.env.AWP_TOKEN}`; //awp password

const HS_API_KEY = process.env.HS_API_KEY; //hs

const hapikeyParam = `hapikey=${HS_API_KEY}`;

//authorization token for AWP
const token = Buffer.from(`${AWP_PUBLIC_KEY}:${AWP_TOKEN}`, "utf8").toString(
  "base64"
);
const api = new WooCommerceRestApi({
  url: "https://advanced.gg",
  consumerKey: "ck_ddb8afcc1afec478aca5a99db60d7f0b786ffe34",
  consumerSecret: "cs_e960108a4316b45777a44f045458930357f2c691",
  version: "wc/v3",
});

const currentYear = new Date().getFullYear();
const today = new Date();
const start_days = [
  new Date(`January 1 ${currentYear}`),
  new Date(`April 1 ${currentYear}`),
  new Date(`July 1 ${currentYear}`),
  new Date(`October 1 ${currentYear}`),
];

const end_days = [
  new Date(`January 8 ${currentYear}`),
  new Date(`April 8 ${currentYear}`),
  new Date(`July 8 ${currentYear}`),
  new Date(`October 8 ${currentYear}`),
];

//start promotion
let start_date = start_days.find(
  (quarter) =>
    today.getDate() == quarter.getDate() &&
    today.getMonth() == quarter.getMonth()
);

//end promotion
let end_date = end_days.find(
  (quarter) =>
    today.getDate() == quarter.getDate() &&
    today.getMonth() == quarter.getMonth()
);

if (!start_date && !end_date) return;

if (start_date) console.log("Starting promotion");
if (end_date) console.log("Ending promotion");

let coupons = {};

const getAllCoupons = (page) => {
  api
    .get("coupons", { page: page, per_page: 100 })
    .then((res) => {
      const data = res.data;
      data.forEach((ele) => {
        ele.meta_data.forEach((meta) => {
          if (start_date) {
            if (
              start_date &&
              meta.key === "affwp_discount_affiliate" &&
              ele.amount === "10.00" &&
              meta.value !== "" &&
              ele.discount_type === "percent"
            ) {
              coupons[ele.id] = {
                awpID: meta.value,
                amount: ele.amount,
                meta_data: ele.meta_data,
              };
            }
          } else if (
            end_date &&
            meta.key === "affwp_quarterly_promotion" &&
            meta.value == "1"
          ) {
            const awpid = ele.meta_data.find(
              (obj) => obj.key === "affwp_discount_affiliate"
            );
            coupons[ele.id] = {
              awpID: awpid && awpid.value,
              amount: ele.amount,
              meta_data: ele.meta_data,
            };
          }
        });
      });
      if (data.length > 0) {
        getAllCoupons(page + 1);
      } else {
        console.log(coupons);
        getContacts();
      }
    })
    .catch((err) => console.log(err));
};

//Entry Point
getAllCoupons(1);

let tier1 = [];
let tier2 = [];

async function getContacts(offset) {
  let offsetParam = offset === undefined ? `` : `&vidOffset=${offset}`;

  const propterties = `&formSubmissionMode=none&property=awp_display_name&property=awp_affiliate_id&property=partner_tier&count=100`;
  const paramsString = `?${hapikeyParam}${propterties}${offsetParam}`;
  const config = {
    headers: {
      "Access-Control-Allow-Origin": "*",
      Accept: "application/json",
    },
  };
  const finalUrl = `https://api.hubapi.com/contacts/v1/lists/1/contacts/all${paramsString}`;
  const res = (await axios.get(finalUrl, config)).data;
  res.contacts.forEach((contact) => {
    const tier =
      contact.properties.partner_tier && contact.properties.partner_tier.value;

    if (tier === "Tier 1") {
      tier1.push(contact.properties.awp_affiliate_id.value);
    } else if (tier === "Tier 2") {
      tier2.push(contact.properties.awp_affiliate_id.value);
    }
  });
  if (res["has-more"]) {
    getContacts(res["vid-offset"]);
  } else {
    console.log("getting contacts done");
    if (start_date) applyPromotions();
    if (end_date) normalize();
  }
}
/**
 * Should only trigger 8th of every quarter or one week after promotion start
 */
const normalize = () => {
  const couponIds = Object.keys(coupons);
  const couponData = {
    update: [],
  };
  couponIds.forEach((id) => {
    if (
      tier1.includes(coupons[id].awpID) ||
      tier2.includes(coupons[id].awpID)
    ) {
      //add tag that coupon is being promoted
      coupons[id].meta_data.find(
        (data) => data.key === "affwp_quarterly_promotion"
      ).value = null;

      //reduce promotions - all 20% couponse -> 10% that were promoted
      couponData.update.push({
        id: id,
        amount: "10.00",
        meta_data: coupons[id].meta_data,
      });
    }
    if (tier2.includes(coupons[id].awpID)) {
      //double commissions - all awp rates * 2
      updateAWPCommission(coupons[id].awpID, 2);
    }
  });

  //only update if updates are necessary
  if (couponData.update.length > 0) updateCoupons(couponData);
};

/**
 * Should only trigger 1st of every quarter
 */
const applyPromotions = () => {
  const couponIds = Object.keys(coupons);
  const couponData = {
    update: [],
  };
  couponIds.forEach((id) => {
    if (
      tier1.includes(coupons[id].awpID) ||
      tier2.includes(coupons[id].awpID)
    ) {
      //add tag that coupon is being promoted
      coupons[id].meta_data.push({
        key: "affwp_quarterly_promotion",
        value: true,
      });

      //double promotion - all 10% coupons -> 20%
      couponData.update.push({
        id: id,
        amount: "20.00",
        meta_data: coupons[id].meta_data,
      });
    }
    if (tier2.includes(coupons[id].awpID)) {
      //half commission - all awp rates * 0.5
      updateAWPCommission(coupons[id].awpID, 0.5);
    }
  });

  //only update if updates are necessary
  if (couponData.update.length > 0) updateCoupons(couponData);
};

/**
 * Batch coupon update
 * @param {*} data - data to be sent to update the coupons with
 */
const updateCoupons = (data) => {
  api
    .post(`coupons/batch`, data)
    .then((response) => {
      console.log(`Updated coupons: `, response.data);
    })
    .catch((error) => {
      console.log(error.response.data);
    });
};

/**
 * Update AWP rates
 *
 * @param {string} id - awp id
 * @param {string} rate - multiplier for current partner's rate
 */
const updateAWPCommission = (id, rate) => {
  const config = {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
    },
  };
  axios
    .get(`http://advanced.gg/wp-json/affwp/v1/affiliates/${id}`, config)
    .then((res) => {
      if (res.data.rate != "" && parseFloat(res.data.rate) != 0) {
        const newRate = parseFloat(res.data.rate) * rate;
        const url = `https://advanced.gg/wp-json/affwp/v1/affiliates/${id}`;
        const params = new URLSearchParams();
        params.append("rate", newRate);
        axios
          .patch(url, params, config)
          .then((res) => {
            console.log(res.data);
          })
          .catch((err) => console.log("patch error: ", err.response.data));
      }
    })
    .catch((err) => console.log("get error: ", res.data));
};
