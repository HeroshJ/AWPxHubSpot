const axios = require("axios");
const cron = require("node-cron");
const dotenv = require("dotenv");
dotenv.config();

const HS_API_KEY = process.env.HS_API_KEY; //hs
const AWP_PUBLIC_KEY = `${process.env.AWP_PUBLIC_KEY}`; //awp username
const AWP_TOKEN = `${process.env.AWP_TOKEN}`; //awp password

//authorization token for AWP
const token = Buffer.from(`${AWP_PUBLIC_KEY}:${AWP_TOKEN}`, "utf8").toString(
  "base64"
);
const hours = process.env.HOURS;
const HOURS_INTERVAL = hours && hours > 0 && hours < 24 ? `0/${hours}` : "0/23"; //hour interval

const hapikeyParam = `hapikey=${HS_API_KEY}`;
const HSconfig = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    Accept: "application/json",
  },
};
let returnedDeals;
let returnedContacts = {};
let returnedProducts = {};

cron.schedule(`0 ${HOURS_INTERVAL} * * *`, function () {
  syncContacts();
});
//=====================================GET HUBSPOT CONTACTS=======================================

async function getContacts(offset) {
  let offsetParam = offset === undefined ? `` : `&vidOffset=${offset}`;

  const propterties = `&formSubmissionMode=none&property=awp_display_name&property=awp_affiliate_id&count=100`;
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
    returnedContacts = {
      ...returnedContacts,
      [contact.properties.awp_affiliate_id.value]: {
        vid: contact.vid,
        display_name: contact.properties.awp_display_name
          ? contact.properties.awp_display_name.value
          : null,
      },
    };
  });
  if (res["has-more"]) {
    getContacts(res["vid-offset"]);
  } else {
    console.log("getting contacts done");
    returnedDeals = new Set();
    getDeals();
  }
}

//=====================================REFERALS=======================================

const getDeals = async (offset) => {
  let offsetParam = offset === undefined ? `` : `&offset=${offset}`;

  const propterties = `&formSubmissionMode=none&properties=awp_referral_id&limit=250`;
  const paramsString = `?${hapikeyParam}${propterties}${offsetParam}`;
  const config = {
    headers: {
      "Access-Control-Allow-Origin": "*",
      Accept: "application/json",
    },
  };
  const finalUrl = `https://api.hubapi.com/deals/v1/deal/paged${paramsString}`;
  const res = (await axios.get(finalUrl, config)).data;
  res.deals.forEach((el) => {
    returnedDeals.add(el.properties.awp_referral_id.value);
  });
  if (res.hasMore) {
    getDeals(res.offset);
  } else {
    console.log("getting hubspot deals, done");

    syncDeals();
  }
};

const syncDeals = async () => {
  const finalUrl = `http://advanced.gg/wp-json/affwp/v1/referrals?user=1&number=0`;
  const config = {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
    },
  };
  axios.get(finalUrl, config).then((referrals) => {
    const data = referrals.data;
    let mappedReferrals = [];
    data.forEach((referral) => {
      if (!returnedDeals.has(referral.referral_id.toString())) {
        mappedReferrals.push(mapDealProps(referral));
      }
    });
    start(mappedReferrals, postDeal);
  });
};

/**
 * asyncForEach() and start() are utility functions to allow for time separation between api calls
 * to accomodate for HubSpot rate limits
 */
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}
const start = async (props, action) => {
  if (props.length < 1) return;
  await asyncForEach(props, async (prop, index) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    prop !== null && action(prop);
    console.log(index);
  });
};

/**
 * Post mapped referral information to HubSpot Deal records
 * @param {Object} props - Deal properties returned from mapDealProps
 */
const postDeal = (props) => {
  const config = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const url = `https://api.hubapi.com/deals/v1/deal?${hapikeyParam}`;
  axios
    .post(url, props.dealInfo, config)
    .then((res) => {
      const dealId = res.data.dealId;
      products = props.products;
      if (products !== "" && products.length >= 1) {
        let count = 1;
        products.forEach((product) => {
          if (!returnedProducts[product.name]) {
            createProduct(product);
            count++;
          }
        });
        setTimeout(() => createLineItem(dealId, products), 1000 * count);
      }
    })
    .catch((err) => console.log(err));
};

/**
 * Map AWP referral info to HubSpot properties
 * @param {Object} deal - AffiliateWP referral information
 */
const mapDealProps = (deal) => {
  if (returnedContacts[deal.affiliate_id]) {
    const vid = returnedContacts[deal.affiliate_id].vid;
    return {
      dealInfo: {
        associations: {
          associatedVids: [vid],
        },
        properties: [
          {
            value: deal.visit_id,
            name: "awp_visit_id",
          },
          {
            value: deal.status,
            name: "awp_status",
          },
          {
            value: deal.description,
            name: "awp_description",
          },
          {
            value: deal.referral_id,
            name: "awp_referral_id",
          },
          {
            value: parseFloat(deal.amount),
            name: "amount",
          },
          {
            value: returnedContacts[deal.affiliate_id].display_name,
            name: "dealname",
          },
          {
            value: 2084695,
            name: "pipeline",
          },
          {
            value:
              deal.status === "paid"
                ? 2084696
                : deal.status === "rejected"
                ? 2084697
                : deal.status === "pending"
                ? 2139858
                : deal.status === "unpaid"
                ? 2139958
                : null,
            name: "dealstage",
          },
        ],
      },
      products: deal.products,
    };
  }
};

//====================================PRODUCTS & LINE ITEMS=========================

const createLineItem = async (dealId, products) => {
  if (products.length === 0) return;
  const lineItemProps = mapLineItem(products);
  const paramsString = `?${hapikeyParam}`;
  const finalUrl = `https://api.hubapi.com/crm-objects/v1/objects/line_items/batch-create${paramsString}`;
  axios
    .post(finalUrl, lineItemProps, HSconfig)
    .then((res) => {
      const associationUrl = `https://api.hubapi.com/crm-associations/v1/associations/create-batch${paramsString}`;
      const properties = mapLineItemstoDeals(res.data, dealId);
      try {
        axios.put(associationUrl, properties, HSconfig);
      } catch (err) {
        console.log(err.response.data);
      }
    })
    .catch((err) => console.log(err.response.data));
};

const mapLineItemstoDeals = (lineItems, dealId) => {
  let arr = [];
  lineItems.forEach((item) => {
    arr.push({
      fromObjectId: item.objectId,
      toObjectId: dealId,
      category: "HUBSPOT_DEFINED",
      definitionId: 20,
    });
  });
  return arr;
};

const getProducts = async (offset) => {
  let offsetParam = offset === undefined ? `` : `&offset=${offset}`;

  const propterties = `&formSubmissionMode=none&properties=name`;
  const paramsString = `?${hapikeyParam}${propterties}${offsetParam}`;
  const finalUrl = `https://api.hubapi.com/crm-objects/v1/objects/products/paged${paramsString}`;
  const res = (await axios.get(finalUrl, HSconfig)).data;
  res.objects.forEach((el) => {
    returnedProducts[el.properties.name.value] = el.objectId;
  });
  if (res.hasMore) {
    getProducts(res.offset);
  } else {
    console.log("getting hubspot products, done");
    getContacts();
  }
};

const mapLineItem = (props) => {
  let arr = [];
  props.forEach((product) => {
    arr.push([
      {
        name: "hs_product_id",
        value: returnedProducts[product.name],
      },
      {
        name: "quantity",
        value: 1,
      },
      {
        name: "price",
        value: Math.abs(product.price),
      },
      {
        name: "name",
        value: product.name,
      },
    ]);
  });
  return arr;
};

const createProduct = async (product) => {
  const properties = createProductProps(product);
  const paramsString = `?${hapikeyParam}`;
  const finalUrl = `https://api.hubapi.com/crm-objects/v1/objects/products${paramsString}`;
  try {
    const res = await axios.post(finalUrl, properties, HSconfig);
    returnedProducts[product.name] = res.data.objectId;
  } catch (err) {
    console.log(err.response.data);
  }
};

const createProductProps = (product) => {
  return [
    {
      name: "name",
      value: product.name,
    },
    {
      name: "price",
      value: Math.abs(product.price),
    },
  ];
};

//=====================================CONTACTS=======================================

/**
 * Fetch all partners from AWP and Map their properties
 */
const syncContacts = async () => {
  const url = `http://advanced.gg/wp-json/affwp/v1/affiliates?user=1&number=0`;
  const config = {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
    },
  };
  try {
    //get all partners
    const partners = (await axios.get(url, config)).data;

    //map to hubspot data
    const contactProps = [];
    partners.forEach((contact) => {
      contactProps.push(mapContactProps(contact));
    });
    postContacts(contactProps).then((res) => getProducts());
  } catch (err) {
    console.log(err);
  }
};

/**
 * Post the contacts to HubSpot via Batch call
 * This will not create duplicate contacts, but override existing ones based on id/email
 * @param {*} contacts
 */
const postContacts = async (contacts) => {
  const url = `https://api.hubapi.com/contacts/v1/contact/batch?${hapikeyParam}`;
  let config = {
    headers: {
      "Access-Control-Allow-Origin": "*",

      "Content-Type": "application/json",
    },
  };
  try {
    const response = await axios.post(url, contacts, config);
    console.log("partners sync: ", response.status);
    return response.statusText;
  } catch (err) {
    console.log(err);
    return "Failed";
  }
};

/**
 * Take AWP contact and map props to HS compatible properties
 * @param {contact obj} contact
 */
const mapContactProps = (contact) => {
  return {
    email: contact.user.user_email,
    properties: [
      {
        property: "awp_affiliate_id",
        value: contact.affiliate_id,
      },
      {
        property: "awp_affilliate_status",
        value: contact.status,
      },
      {
        property: "awp_date_registered",
        value: contact.date_registered,
      },
      {
        property: "awp_earnings",
        value: contact.earnings,
      },
      {
        property: "awp_payment_email",
        value: contact.payment_email,
      },
      {
        property: "awp_referral_rate",
        value: contact.rate,
      },
      {
        property: "awp_referral_rate_type",
        value: contact.rate_type,
      },
      {
        property: "awp_referrals",
        value: contact.referrals,
      },
      {
        property: "awp_unpaid_earnings",
        value: contact.unpaid_earnings,
      },
      {
        property: "awp_user_id",
        value: contact.user_id,
      },
      {
        property: "awp_visits",
        value: contact.visits,
      },
      {
        property: "firstname",
        value: contact.user.first_name,
      },
      {
        property: "lastname",
        value: contact.user.last_name,
      },
      {
        property: "awp_display_name",
        value: contact.user.display_name,
      },
    ],
  };
};
