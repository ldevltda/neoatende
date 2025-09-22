// handleChartbot.ts
import Queue from "../../../models/Queue";
import QueueOption from "../../../models/QueueOption";
import Setting from "../../../models/Setting";
import formatBody from "../../../helpers/Mustache";
import { debounce } from "../../../helpers/Debounce";
import UpdateTicketService from "../../TicketServices/UpdateTicketService";
import SendWhatsAppMessage from "../SendWhatsAppMessage";
import { isNil } from "lodash";

export const handleChartbot = async (
  ticket: any,
  msg: any,
  wbot: any,
  dontReadTheFirstQuestion: boolean = false
) => {
  const queue = await Queue.findByPk(ticket.queueId, {
    include: [
      {
        model: QueueOption,
        as: "options",
        where: { parentId: null },
        order: [
          ["option", "ASC"],
          ["createdAt", "ASC"]
        ]
      }
    ]
  });

  const { getBodyMessage } = await import("./messageHelpers");
  const body = getBodyMessage(msg);

  if (body == "#") {
    await ticket.update({ queueOptionId: null, chatbot: false, queueId: null });
    await (await import("./handleQueue")).verifyQueue(wbot, msg, ticket, ticket.contact);
    return;
  }

  if (!queue) return;

  // voltar para o menu anterior
  if (!isNil(queue) && !isNil(ticket.queueOptionId) && body == "0") {
    const option = await QueueOption.findByPk(ticket.queueOptionId);
    await ticket.update({ queueOptionId: option?.parentId });
  } else if (!isNil(queue) && !isNil(ticket.queueOptionId)) {
    const count = await QueueOption.count({
      where: { parentId: ticket.queueOptionId }
    });
    let option: any = {};
    if (count == 1) {
      option = await QueueOption.findOne({
        where: { parentId: ticket.queueOptionId }
      });
    } else {
      option = await QueueOption.findOne({
        where: {
          option: body || "",
          parentId: ticket.queueOptionId
        }
      });
    }
    if (option) {
      await ticket.update({ queueOptionId: option?.id });
    }
  } else if (!isNil(queue) && isNil(ticket.queueOptionId) && !dontReadTheFirstQuestion) {
    const option = queue?.options.find((o: any) => o.option == body);
    if (option) {
      await ticket.update({ queueOptionId: option?.id });
    }
  }

  await ticket.reload();

  if (!isNil(queue) && isNil(ticket.queueOptionId)) {
    const queueOptions = await QueueOption.findAll({
      where: { queueId: ticket.queueId, parentId: null },
      order: [
        ["option", "ASC"],
        ["createdAt", "ASC"]
      ]
    });

    const companyId = ticket.companyId;

    const buttonActive = await Setting.findOne({
      where: {
        key: "chatBotType",
        companyId
      }
    });

    const botButton = async () => {
      const buttons = [];
      queueOptions.forEach((option, i) => {
        buttons.push({
          buttonId: `${option.option}`,
          buttonText: { displayText: option.title },
          type: 4
        });
      });
      buttons.push({
        buttonId: `#`,
        buttonText: { displayText: "Menu inicial *[ 0 ]* Menu anterior" },
        type: 4
      });

      const buttonMessage = {
        text: formatBody(`\u200e${queue.greetingMessage}`, ticket.contact),
        buttons,
        headerType: 4
      };

      const sendMsg = await wbot.sendMessage(
        `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
        buttonMessage
      );

      const { verifyMessage } = await import("./mediaHelpers").catch(()=>({ verifyMessage: null }));
      if (verifyMessage) await verifyMessage(sendMsg, ticket, ticket.contact);
    };

    const botText = async () => {
      let options = "";

      queueOptions.forEach((option, i) => {
        options += `*[ ${option.option} ]* - ${option.title}\n`;
      });
      options += `\n*[ # ]* - Menu inicial`;

      const textMessage = {
        text: formatBody(
          `\u200e${queue.greetingMessage}\n\n${options}`,
          ticket.contact
        )
      };

      const sendMsg = await wbot.sendMessage(
        `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
        textMessage
      );

      const { verifyMessage } = await import("./mediaHelpers").catch(()=>({ verifyMessage: null }));
      if (verifyMessage) await verifyMessage(sendMsg, ticket, ticket.contact);
    };

    if (buttonActive.value === "button" && queueOptions.length <= 4) {
      return botButton();
    }

    if (buttonActive.value === "text") {
      return botText();
    }

    if (buttonActive.value === "button" && queueOptions.length > 4) {
      return botText();
    }
  } else if (!isNil(queue) && !isNil(ticket.queueOptionId)) {
    const currentOption = await QueueOption.findByPk(ticket.queueOptionId);
    const queueOptions = await QueueOption.findAll({
      where: { parentId: ticket.queueOptionId },
      order: [
        ["option", "ASC"],
        ["createdAt", "ASC"]
      ]
    });

    if (queueOptions.length > -1) {
      const companyId = ticket.companyId;
      const buttonActive = await Setting.findOne({
        where: {
          key: "chatBotType",
          companyId
        }
      });

      const botList = async () => {
        const sectionsRows: any[] = [];

        queueOptions.forEach((option, i) => {
          sectionsRows.push({
            title: option.title,
            rowId: `${option.option}`
          });
        });
        sectionsRows.push({
          title: "Menu inicial *[ 0 ]* Menu anterior",
          rowId: `#`
        });
        const sections = [
          {
            rows: sectionsRows
          }
        ];

        const listMessage = {
          text: formatBody(`\u200e${currentOption.message}`, ticket.contact),
          buttonText: "Escolha uma opção",
          sections
        };

        const sendMsg = await wbot.sendMessage(
          `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          listMessage
        );

        const { verifyMessage } = await import("./mediaHelpers").catch(()=>({ verifyMessage: null }));
        if (verifyMessage) await verifyMessage(sendMsg, ticket, ticket.contact);
      };

      const botButton = async () => {
        const buttons = [];
        queueOptions.forEach((option, i) => {
          buttons.push({
            buttonId: `${option.option}`,
            buttonText: { displayText: option.title },
            type: 4
          });
        });
        buttons.push({
          buttonId: `#`,
          buttonText: { displayText: "Menu inicial *[ 0 ]* Menu anterior" },
          type: 4
        });

        const buttonMessage = {
          text: formatBody(`\u200e${currentOption.message}`, ticket.contact),
          buttons,
          headerType: 4
        };

        const sendMsg = await wbot.sendMessage(
          `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          buttonMessage
        );

        const { verifyMessage } = await import("./mediaHelpers").catch(()=>({ verifyMessage: null }));
        if (verifyMessage) await verifyMessage(sendMsg, ticket, ticket.contact);
      };

      const botText = async () => {
        let options = "";

        queueOptions.forEach((option, i) => {
          options += `*[ ${option.option} ]* - ${option.title}\n`;
        });
        options += `\n*[ 0 ]* - Menu anterior`;
        options += `\n*[ # ]* - Menu inicial`;
        const textMessage = {
          text: formatBody(
            `\u200e${currentOption.message}\n\n${options}`,
            ticket.contact
          )
        };

        const sendMsg = await wbot.sendMessage(
          `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          textMessage
        );

        const { verifyMessage } = await import("./mediaHelpers").catch(()=>({ verifyMessage: null }));
        if (verifyMessage) await verifyMessage(sendMsg, ticket, ticket.contact);
      };

      if (buttonActive.value === "list") {
        return botList();
      }

      if (buttonActive.value === "button" && queueOptions.length <= 4) {
        return botButton();
      }

      if (buttonActive.value === "text") {
        return botText();
      }

      if (buttonActive.value === "button" && queueOptions.length > 4) {
        return botText();
      }
    }
  }
};
